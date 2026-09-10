/* =====================================================================
   Dotforge — render.js
   캔버스 크기/줌 + 메인 렌더 + 어니언 스킨 + 그리드 + 셀 좌표 변환.
   REFACTOR.md 모듈 분리 3단계.

   의존:
   - DF.state, DF.flattenFrame (state.js, 먼저 로드됨)
   - 캔버스 참조 const: $, bgCanvas, onion1~3, mainCanvas, gridCanvas, sizer,
     mainCtx, onionCtxs, gridCtx — 아직 index.html 인라인 top-level const.
     함수 "호출 시점"(인라인 실행 후)에 전역 lexical 환경으로 해소된다.
     (color.js가 `$`를 쓰는 방식과 동일. 모든 모듈 분리 완료 시 dom 모듈로 이전)
   - drawSelectionOverlay, renderFrameList, applyRefTransform — 아직 인라인,
     런타임에 window 전역으로 해소.

   노출: DF + window 병행(전환기).
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state, flattenFrame } = DF;

function initCanvasSize() {
  const wrap = $('canvasWrap');
  // 레이아웃이 아직 안 잡혀 크기가 0이면 화면 크기로 폴백 (캔버스가 32px로 쪼그라드는 것 방지)
  let cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw < 64) cw = Math.max(320, window.innerWidth - 350);
  if (ch < 64) ch = Math.max(320, window.innerHeight - 220);
  const avail = Math.min(cw - 48, ch - 48);
  // 화면에 맞는 기본 배율 (줌 1.0 기준)
  const baseScale = Math.max(1, Math.floor(avail / state.res));
  state.baseDisplay = baseScale * state.res;
  applyZoom();   // 줌을 곱해 최종 크기 적용
}

// 현재 줌 배율을 캔버스 크기에 반영
function applyZoom() {
  state.display = Math.round(state.baseDisplay * state.zoom);
  [bgCanvas, onion1, onion2, onion3, mainCanvas, gridCanvas, sizer].forEach(c => {
    c.width = state.res; c.height = state.res;
    c.style.width = state.display + 'px';
    c.style.height = state.display + 'px';
  });
  const zEl = $('zoomLabel');
  if (zEl) zEl.textContent = Math.round(state.zoom * 100) + '%';
  drawGrid();
  render();
}
function setZoom(z) {
  state.zoom = Math.max(0.25, Math.min(8, z));
  applyZoom();
}

// ---------- 렌더링 ----------
function render() {
  const fr = state.frames[state.current];
  mainCtx.clearRect(0, 0, state.res, state.res);
  for (let li = 0; li < fr.layers.length; li++) {
    const L = fr.layers[li];
    if (!L.visible || L.opacity <= 0) continue;
    mainCtx.globalAlpha = L.opacity;
    mainCtx.globalCompositeOperation = L.blend || 'source-over';
    const p = L.pixels;
    for (let i = 0; i < p.length; i++)
      if (p[i]) { mainCtx.fillStyle = p[i]; mainCtx.fillRect(i % state.res, (i / state.res) | 0, 1, 1); }
    // 활성 레이어이고 떠있는 선택 픽셀이 있으면 그 위에 그림
    if (li === fr.active && state.selFloat) {
      const F = state.selFloat;
      for (let y = 0; y < F.h; y++)
        for (let x = 0; x < F.w; x++) {
          const c = F.pixels[y*F.w+x];
          if (c) { mainCtx.fillStyle = c; mainCtx.fillRect(F.ox + x, F.oy + y, 1, 1); }
        }
    }
  }
  mainCtx.globalAlpha = 1;
  mainCtx.globalCompositeOperation = 'source-over';
  renderOnion();
  // 선택 영역이 있으면 그리드를 다시 그려 이전 점선을 지운 뒤 새로 그림 (누적 방지)
  if (state.selection || state.selFloat) { drawGrid(); drawSelectionOverlay(); }
  renderFrameList();
  // 시트 밑그림이면 현재 프레임에 맞는 칸으로 갱신
  if (state.refVisible && state.ref && state.ref.sheet && typeof applyRefTransform === 'function') applyRefTransform();
  const ub = $('undoBtn'), rb = $('redoBtn');
  if (ub) ub.disabled = state.undoStack.length === 0;
  if (rb) rb.disabled = state.redoStack.length === 0;
  // 참고판 GIF를 현재 프레임에 동기화(로토스코프) — gif 동기화 타일 없으면 거의 무비용
  if (window.DF && DF.RefBoard && DF.RefBoard.syncFrame) DF.RefBoard.syncFrame();
}

function renderOnion() {
  const layers = [onion1, onion2, onion3];
  const ctxs = onionCtxs;
  ctxs.forEach(ctx => ctx.clearRect(0, 0, state.res, state.res));
  onion1.style.zIndex = 10; onion2.style.zIndex = 6; onion3.style.zIndex = 5;
  layers.forEach(l => l.style.opacity = 0);
  if (!state.showOnion || state.playing) { return; }

  const count = state.shiftHeld ? Math.max(1, state.onionCount) : state.onionCount;
  for (let k = 1; k <= count && k <= 3; k++) {
    const idx = state.current - k;
    if (idx < 0) break;
    const ctx = ctxs[k - 1];
    const prev = flattenFrame(state.frames[idx]);   // 이전 프레임은 합성 결과로 표시
    for (let y = 0; y < state.res; y++)
      for (let x = 0; x < state.res; x++) {
        const c = prev[y * state.res + x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
      }
    // 단계별 투명도: 직전 = onionOpacity, 그 다음부터 ×0.3씩 감소
    layers[k - 1].style.opacity = state.onionOpacity * Math.pow(0.3, k - 1);
  }

  // Shift 누르면 직전 프레임(onion1)을 메인 위로 올리고 거의 불투명하게 → 색 추출 가능
  if (state.shiftHeld) {
    onion1.style.zIndex = 25;            // 메인(z-20)보다 위, 그리드(z-30)보단 아래
    onion1.style.opacity = 0.85;
  }
}

function drawGrid() {
  gridCanvas.style.display = state.showGrid ? 'block' : 'none';
  if (!state.showGrid) return;
  gridCanvas.width = state.display;
  gridCanvas.height = state.display;
  gridCanvas.style.width = state.display + 'px';
  gridCanvas.style.height = state.display + 'px';
  const cell = state.display / state.res;
  gridCtx.clearRect(0, 0, state.display, state.display);
  gridCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  gridCtx.lineWidth = 1;
  for (let i = 0; i <= state.res; i++) {
    const p = Math.round(i * cell) + 0.5;
    gridCtx.beginPath(); gridCtx.moveTo(p, 0); gridCtx.lineTo(p, state.display); gridCtx.stroke();
    gridCtx.beginPath(); gridCtx.moveTo(0, p); gridCtx.lineTo(state.display, p); gridCtx.stroke();
  }
}

function getCell(e, clamp) {
  const rect = mainCanvas.getBoundingClientRect();
  let x = Math.floor((e.clientX - rect.left) / rect.width * state.res);
  let y = Math.floor((e.clientY - rect.top) / rect.height * state.res);
  if (clamp) {
    // 캔버스 밖으로 나가도 가장자리에 붙여 선이 끊기지 않게
    x = Math.max(0, Math.min(state.res - 1, x));
    y = Math.max(0, Math.min(state.res - 1, y));
  } else if (x < 0 || y < 0 || x >= state.res || y >= state.res) return null;
  return { x, y, i: y * state.res + x };
}

// ---------- 노출 ----------
const exported = { initCanvasSize, applyZoom, setZoom, render, renderOnion, drawGrid, getCell };
Object.assign(DF, exported);
// 전환기 병행 노출 (전체 분리 완료 시 제거)
Object.assign(window, exported);

})(window.DF);
