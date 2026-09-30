/* =====================================================================
   Dotforge — AI 스프라이트 생성 프록시
   ---------------------------------------------------------------------
   브라우저에서 Gemini API를 직접 부르면 (1) CORS 차단 (2) API 키 노출
   문제가 생긴다. 이 프록시가 키를 서버에만 두고 대신 호출해준다.

   실행:
     GEMINI_API_KEY=AIza... node server.js
   여러 키 로테이션:
     GEMINI_API_KEYS=key1,key2,key3 node server.js
   포트 지정:
     PORT=8787 node server.js
   ===================================================================== */
const http = require('http');
const https = require('https');

// ---------- 설정 ----------
const PORT = parseInt(process.env.PORT || '8787', 10);
// 이미지 생성 모델. 바뀌면 여기만 수정.
//  - gemini-2.5-flash-image : 현행 안정 
//  - gemini-3.1-flash-image : 최신(있으면 이걸로)
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const HOST = 'generativelanguage.googleapis.com';

// 키 로드 (단일 또는 콤마 구분 다중 → 라운드로빈)
const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (!KEYS.length) {
  console.error('❌ GEMINI_API_KEY(또는 GEMINI_API_KEYS) 환경변수가 필요합니다.');
  process.exit(1);
}
let keyIdx = 0;
const nextKey = () => { const k = KEYS[keyIdx % KEYS.length]; keyIdx++; return k; };

// 픽셀아트 품질을 위한 프롬프트 보강. 사용자가 원하면 raw 모드로 끌 수 있음.
function buildPrompt(userPrompt, opts) {
  const base = String(userPrompt || '').slice(0, 800).trim();
  if (opts && opts.raw) return base;
  // 도트 변환 파이프라인이 잘 먹도록 배경 분리 + 단일 캐릭터 유도
  return [
    base,
    'pixel art style, single subject centered in frame,',
    'clean solid background (flat single color, no gradient),',
    'no text, no watermark, no border, full body visible,',
    'crisp edges, limited color palette'
  ].join(' ');
}

// Gemini 호출
//  authMode: 'header' → x-goog-api-key 헤더 (기본, AIza·AQ. 모두 동작)
//            'query'  → ?key= 쿼리 파라미터 (일부 환경의 AQ. 키 폴백)
function callGemini(prompt, key, authMode) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['Image'] }
    });
    const useQuery = authMode === 'query';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    // 키 형식(AIza / AQ.)을 검증하지 않고 그대로 전달한다.
    // 형식 검증은 새 키 체계가 나올 때마다 깨지는 안티패턴.
    if (!useQuery) headers['x-goog-api-key'] = key;
    const path = `/v1beta/models/${MODEL}:generateContent`
      + (useQuery ? `?key=${encodeURIComponent(key)}` : '');
    const req = https.request({
      host: HOST,
      path,
      method: 'POST',
      headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Gemini 요청 시간 초과')); });
    req.write(body);
    req.end();
  });
}

// 응답에서 첫 이미지 파트 추출 → { mime, data(base64) }
function extractImage(json) {
  try {
    const parts = json.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const d = p.inlineData || p.inline_data;
      if (d && d.data) return { mime: d.mimeType || d.mime_type || 'image/png', data: d.data };
    }
  } catch (e) {}
  return null;
}

const server = http.createServer(async (req, res) => {
  // CORS (배포 시 도메인 제한 권장)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/generate-sprite') {
    let raw = '';
    let tooBig = false;
    req.on('data', c => { raw += c; if (raw.length > 5000) { tooBig = true; req.destroy(); } });
    req.on('end', async () => {
      if (tooBig) return;
      let payload;
      try { payload = JSON.parse(raw); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '잘못된 요청 형식' }));
      }
      const prompt = buildPrompt(payload.prompt, { raw: payload.raw });
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '프롬프트가 비어 있습니다.' }));
      }
      // 키 로테이션 + 실패 시 다음 키 재시도
      // 각 키는 헤더 인증 → (401/UNAUTHENTICATED면) 쿼리 인증으로 폴백.
      // AQ. 키가 특정 환경에서 헤더를 거부할 때를 대비.
      let lastErr = null;
      let sawAuthErr = false;
      for (let attempt = 0; attempt < Math.min(KEYS.length, 3); attempt++) {
        const key = nextKey();
        for (const authMode of ['header', 'query']) {
          try {
            const { status, data } = await callGemini(prompt, key, authMode);
            if (status === 429) { lastErr = `HTTP 429 (쿼터 초과)`; break; }      // 다음 키로
            let json; try { json = JSON.parse(data); } catch (e) {
              // JSON이 아닌 응답(HTML 에러/네트워크 차단 메시지 등) → 원문 일부 노출
              lastErr = `HTTP ${status}: ` + String(data).slice(0, 160).replace(/\s+/g, ' ').trim();
              if (status === 401 || status === 403) { sawAuthErr = (authMode==='query'); if (authMode==='header') continue; }
              break;
            }
            if (status === 401 || status === 403) {
              sawAuthErr = true;
              lastErr = json.error?.message || `HTTP ${status}`;
              // 헤더에서 인증 실패면 쿼리 방식으로 한 번 더 시도, 그래도 안 되면 다음 키
              if (authMode === 'header') continue;
              break;
            }
            if (status !== 200) { lastErr = json.error?.message || `HTTP ${status}`; break; }
            const img = extractImage(json);
            if (!img) { lastErr = '이미지가 반환되지 않았습니다.'; break; }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ mime: img.mime, data: img.data }));
          } catch (e) { lastErr = e.message; break; }
        }
      }
      // 인증 오류였다면 키 관련 힌트를 덧붙임 (AIza/AQ. 무관하게 통과되어야 정상)
      let hint = '';
      if (sawAuthErr) hint = ' — API 키가 유효한지, Gemini API 사용 권한이 있는지 확인하세요. (AIza·AQ. 키 모두 지원)';
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '생성 실패: ' + (lastErr || '알 수 없는 오류') + hint }));
    });
    return;
  }

  // 헬스체크
  if (req.method === 'GET' && req.url === '/api/health') {
    // 키 형식별 개수 (검증이 아니라 표시용 — 어떤 형식이든 통과시킴)
    const kinds = KEYS.reduce((a, k) => {
      const t = k.startsWith('AQ.') ? 'AQ' : (k.startsWith('AIza') ? 'AIza' : 'other');
      a[t] = (a[t] || 0) + 1; return a;
    }, {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, model: MODEL, keys: KEYS.length, keyKinds: kinds }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`✅ Dotforge AI 프록시 실행 중  http://localhost:${PORT}`);
  console.log(`   모델: ${MODEL}  |  키 ${KEYS.length}개 로드`);
  console.log(`   엔드포인트: POST /api/generate-sprite  { prompt, raw? }`);
});
