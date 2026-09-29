/* =====================================================================
   Dotforge — normalmap.js
   프레임 → 노멀맵(법선맵) 자동 생성. 유니티 2D 조명(URP Light2D)이 이 맵을
   읽어 "맵의 조명 방향에 따라 스프라이트 명암을 실시간 계산"하게 만든다.
   즉 그림에 미리 칠한 명암이 아니라, 게임 안 램프 옆에 가면 그쪽이 밝아지는
   진짜 하이비트 다이내믹 라이팅의 핵심 데이터.

   업계 도구(Laigter, Sprite DLight)와 같은 방식:
   1) 실루엣(알파) 가장자리에서 안쪽으로 들어갈수록 높아지는 높이장(베벨) 생성
   2) 밝기(명도)를 높이 디테일로 소량 혼합
   3) 높이장을 Sobel/중앙차분해 법선을 구하고 RGB로 인코딩(OpenGL: +Y 위)

   노출: DF.NormalMap. 순수 함수(res 크기 canvas 반환) + 미리보기 패널.
   의존: DF.state, DF.flattenFrame, DF.hexToRgb.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state, flattenFrame, hexToRgb } = DF;
const $ = (id) => document.getElementById(id);

// 노멀맵 생성 설정 (state.normalMap과 연동, 없으면 기본값)
function cfg() {
  return state.normalMap || (state.normalMap = { strength: 1.4, bevel: 3, detail: 0.35, flipY: true });
}

// 프레임(합성) → 노멀맵 canvas(res×res, RGBA). 투명 픽셀은 평면(128,128,255,0).
function buildFromFrame(frame, opts) {
  const o = Object.assign({}, cfg(), opts || {});
  const strength = o.strength, bevel = Math.max(0.5, o.bevel), lumAmt = o.detail;
  const flipY = o.flipY !== false;
  const res = state.res, N = res * res;
  const flat = flattenFrame(frame);

  const solid = new Uint8Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const hex = flat[i];
    if (hex) { const c = hexToRgb(hex); if (c) { solid[i] = 1; lum[i] = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; } }
  }

  // 실루엣 가장자리로부터의 거리(챔퍼 거리변환) — 안쪽일수록 큼
  const INF = 1e6, dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = solid[i] ? INF : 0;
  const idx = (x, y) => y * res + x;
  const relax = (x, y, dx, dy, cost) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= res || ny >= res) return;
    const v = dist[idx(nx, ny)] + cost;
    if (v < dist[idx(x, y)]) dist[idx(x, y)] = v;
  };
  const D = Math.SQRT2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    relax(x, y, -1, 0, 1); relax(x, y, 0, -1, 1); relax(x, y, -1, -1, D); relax(x, y, 1, -1, D);
  }
  for (let y = res - 1; y >= 0; y--) for (let x = res - 1; x >= 0; x--) {
    relax(x, y, 1, 0, 1); relax(x, y, 0, 1, 1); relax(x, y, 1, 1, D); relax(x, y, -1, 1, D);
  }

  // 높이장: 베벨(가장자리 경사) + 밝기 디테일
  const H = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!solid[i]) { H[i] = 0; continue; }
    const edge = Math.min(1, dist[i] / bevel);
    H[i] = edge * (1 - lumAmt) + lum[i] * lumAmt;
  }
  const Hat = (x, y) => {
    if (x < 0) x = 0; else if (x >= res) x = res - 1;
    if (y < 0) y = 0; else if (y >= res) y = res - 1;
    return H[y * res + x];
  };

  const canvas = document.createElement('canvas');
  canvas.width = res; canvas.height = res;
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(res, res), d = id.data;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const p = y * res + x, ofs = p * 4;
    if (!solid[p]) { d[ofs] = 128; d[ofs + 1] = 128; d[ofs + 2] = 255; d[ofs + 3] = 0; continue; }
    const gx = Hat(x + 1, y) - Hat(x - 1, y);
    let gy = Hat(x, y + 1) - Hat(x, y - 1);   // canvas: y가 아래로 증가
    // OpenGL 노멀맵(+Y 위)로 맞추려면 canvas의 아래방향 기울기를 뒤집는다
    if (flipY) gy = -gy;
    let nx = -gx * strength, ny = -gy * strength, nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    d[ofs] = Math.round((nx * 0.5 + 0.5) * 255);
    d[ofs + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    d[ofs + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    d[ofs + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

// ---------- 미리보기 패널 (편의성: 슬라이더 조절하며 결과 확인) ----------
let panelEl = null, prevCv = null;
function drawPreview() {
  if (!prevCv) return;
  const nm = buildFromFrame(DF.curFrame ? DF.curFrame() : state.frames[state.current]);
  const ctx = prevCv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, prevCv.width, prevCv.height);
  // 체커 배경(투명 확인)
  ctx.fillStyle = '#27272a'; ctx.fillRect(0, 0, prevCv.width, prevCv.height);
  ctx.drawImage(nm, 0, 0, state.res, state.res, 0, 0, prevCv.width, prevCv.height);
}

function buildPanel() {
  const c = cfg();
  const p = document.createElement('div');
  panelEl = p;
  p.style.cssText = 'position:fixed;z-index:80;width:240px;background:rgba(24,24,27,.98);border:1px solid #3f3f46;' +
    'border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.55);font-size:12px;color:#e4e4e7;user-select:none;';
  p.addEventListener('pointerdown', e => e.stopPropagation());
  p.innerHTML = '<div style="font-weight:600;margin-bottom:8px">🧭 노멀맵 (다이내믹 조명)</div>';

  prevCv = document.createElement('canvas');
  prevCv.width = 96; prevCv.height = 96;
  prevCv.style.cssText = 'width:96px;height:96px;image-rendering:pixelated;border:1px solid #3f3f46;border-radius:6px;display:block;margin:0 auto 8px;';
  p.appendChild(prevCv);

  const slider = (label, key, min, max, step, fmt) => {
    const row = document.createElement('div'); row.style.cssText = 'margin:8px 0;';
    const top = document.createElement('div'); top.style.cssText = 'display:flex;justify-content:space-between;color:#a1a1aa;margin-bottom:2px;';
    const nm = document.createElement('span'); nm.textContent = label;
    const vv = document.createElement('span'); vv.style.color = '#d4d4d8';
    top.appendChild(nm); top.appendChild(vv); row.appendChild(top);
    const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = c[key]; r.style.width = '100%';
    const show = () => vv.textContent = fmt ? fmt(c[key]) : c[key];
    r.addEventListener('input', () => { c[key] = parseFloat(r.value); show(); drawPreview(); });
    r.addEventListener('change', () => { if (typeof autoSave === 'function') autoSave(); });
    row.appendChild(r); show();
    p.appendChild(row);
  };
  slider('굴곡 세기', 'strength', 0.2, 4, 0.05, v => v.toFixed(2) + '×');
  slider('가장자리 경사', 'bevel', 1, 8, 0.5, v => v.toFixed(1) + 'px');
  slider('밝기 디테일', 'detail', 0, 1, 0.05, v => Math.round(v * 100) + '%');

  const frow = document.createElement('div'); frow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
  const fchk = document.createElement('input'); fchk.type = 'checkbox'; fchk.checked = c.flipY !== false; fchk.id = 'nmFlipY';
  const flab = document.createElement('label'); flab.htmlFor = 'nmFlipY'; flab.textContent = 'Y 뒤집기 (OpenGL/Unity)'; flab.style.color = '#a1a1aa';
  fchk.addEventListener('change', () => { c.flipY = fchk.checked; drawPreview(); if (typeof autoSave === 'function') autoSave(); });
  frow.appendChild(fchk); frow.appendChild(flab); p.appendChild(frow);

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:10px;color:#71717a;font-size:11px;line-height:1.4;';
  note.textContent = '내보내기 → 🎮 Unity → 다이내믹 조명에서 노멀맵이 함께 저장됩니다. Unity가 맵 조명에 반응해 명암을 계산해요.';
  p.appendChild(note);

  document.body.appendChild(p);
  drawPreview();
}
function positionPanel() {
  if (!panelEl) return;
  const btn = $('normalBtn');
  const r = btn ? btn.getBoundingClientRect() : { right: 60, top: 120 };
  panelEl.style.left = Math.min(r.right + 8, (window.innerWidth || 9999) - 260) + 'px';
  panelEl.style.top = Math.min(r.top, (window.innerHeight || 9999) - 400) + 'px';
}
function hidePanel() { if (panelEl) { panelEl.remove(); panelEl = null; prevCv = null; } }
function togglePanel() { if (panelEl) { hidePanel(); return; } buildPanel(); positionPanel(); }

function init() {
  const btn = $('normalBtn');
  if (btn) btn.addEventListener('click', togglePanel);
  window.addEventListener('pointerdown', e => {
    if (panelEl && !panelEl.contains(e.target) && e.target !== $('normalBtn')) hidePanel();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hidePanel(); });
  window.addEventListener('resize', positionPanel);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

DF.NormalMap = { buildFromFrame, togglePanel, cfg };

})(window.DF);
