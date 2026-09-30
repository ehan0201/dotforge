/* =====================================================================
   Dotforge — cutout.js  (DF.Cutout)
   고품질 배경 제거(누끼). 가장자리에서 플러드필로 "배경에 연결된" 영역만
   지우므로, 캐릭터 내부의 같은 색은 보존된다(전역 색매칭 방식의 한계 개선).
   - 그라데이션 배경: 전역 배경색 허용치 + 이웃 유사도(지역 성장) 병행.
   - 앤티에일리어싱 경계: 가장자리 픽셀에 부분 알파(페더) 적용해 하얀 테두리 방지.
   빌드 없음. window.DF 네임스페이스.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

function colorDist(d, i, r, g, b) {
  // 맨해튼 거리(빠름, 충분히 정확)
  return Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b);
}

// 가장자리 표본으로 배경색(평균) 추정
function estimateBg(d, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const add = (x, y) => { const i = (y * w + x) * 4; if (d[i + 3] < 8) return; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
  if (!n) return { r: 0, g: 0, b: 0, transparent: true };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), transparent: false };
}

// 배경 마스크: 1=배경(연결됨). 가장자리에서 시작해 4방향 확장.
// tol: 전역 배경색 허용치(맨해튼, 0~765). local: 이웃과의 유사도 허용치.
function maskFromImageData(id, opts) {
  opts = opts || {};
  const w = id.width, h = id.height, d = id.data;
  const tol = (opts.tol != null ? opts.tol : 32) * 3;      // 채널당 tol → 맨해튼 합
  const local = (opts.local != null ? opts.local : 16) * 3;
  const bg = opts.bg || estimateBg(d, w, h);
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    const p = y * w + x, i = p * 4;
    if (isBg[p]) return;
    if (d[i + 3] < 16 || colorDist(d, i, bg.r, bg.g, bg.b) <= tol) { isBg[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(), pi = p * 4;
    const x = p % w, y = (p - x) / w;
    const grow = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const np = ny * w + nx; if (isBg[np]) return;
      const ni = np * 4;
      // 투명하거나, 전역 배경색과 비슷하거나, 이미 배경인 이웃과 비슷하면 배경으로 편입
      if (d[ni + 3] < 16 ||
          colorDist(d, ni, bg.r, bg.g, bg.b) <= tol ||
          colorDist(d, ni, d[pi], d[pi + 1], d[pi + 2]) <= local) {
        isBg[np] = 1; stack.push(np);
      }
    };
    grow(x - 1, y); grow(x + 1, y); grow(x, y - 1); grow(x, y + 1);
  }
  return { isBg, bg, w, h };
}

// ImageData에 마스크 적용(배경 알파 0). feather=true면 경계 픽셀 부분 알파.
function applyMask(id, mask, opts) {
  opts = opts || {};
  const w = id.width, h = id.height, d = id.data;
  const { isBg, bg } = mask;
  const feather = opts.feather !== false;
  const tol = (opts.tol != null ? opts.tol : 32) * 3;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (isBg[p]) { d[i + 3] = 0; continue; }
    if (!feather) continue;
    // 배경 이웃이 있는 전경 픽셀 → 배경색과 가까운 정도로 부분 알파
    const x = p % w, y = (p - x) / w;
    let edge = false;
    if (x > 0 && isBg[p - 1]) edge = true;
    else if (x < w - 1 && isBg[p + 1]) edge = true;
    else if (y > 0 && isBg[p - w]) edge = true;
    else if (y < h - 1 && isBg[p + w]) edge = true;
    if (!edge) continue;
    const dist = colorDist(d, i, bg.r, bg.g, bg.b);
    if (dist < tol * 1.7) {
      const a = Math.max(0, Math.min(1, (dist - tol) / (tol * 0.7)));
      d[i + 3] = Math.round(d[i + 3] * a);
    }
  }
  return id;
}

// 이미지/캔버스 → 배경 제거된 PNG data URL
function fromImage(img, opts) {
  opts = opts || {};
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  let id;
  try { id = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }
  const mask = maskFromImageData(id, opts);
  applyMask(id, mask, opts);
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/png');
}

// data URL → 배경 제거된 data URL (비동기)
function fromDataURL(dataUrl, opts) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { try { resolve(fromImage(img, opts) || dataUrl); } catch (e) { resolve(dataUrl); } };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

DF.Cutout = { maskFromImageData, applyMask, fromImage, fromDataURL, estimateBg };

})(window.DF);
