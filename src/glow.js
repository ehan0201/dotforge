/* =====================================================================
   Dotforge — glow.js
   글로우/조명(산나비풍 네온 발광 블룸).
   밝은(임계값 이상) 픽셀을 뽑아 흐리게 번지게 해 additive로 얹는다.
   - 실시간 미리보기: glowCanvas(스테이지, mix-blend-mode:screen)에 그림.
   - 내보내기: frameToCanvas가 DF.Glow.bake로 결과 PNG/시트/GIF에 구움.
   - 설정 패널: 💡 툴바 버튼으로 토글(켜기/임계값/세기/번짐/색조).

   의존: DF.state, DF.curFrame, DF.flattenFrame, DF.hexToRgb.
   런타임 bare: $ (없어도 자체 헬퍼). 노출: DF.Glow.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state, flattenFrame, curFrame, hexToRgb } = DF;
const $ = (id) => document.getElementById(id);

let _emCanvas = null;   // 발광원(res 크기) 스크래치
let panelEl = null;

// 발광원 만들기: source에 따라 (1) 발광 지정 레이어의 픽셀 (2) 임계값 이상 밝기 픽셀
// 을 담은 res 크기 캔버스 (없으면 null). 하이비트의 정석 = 발광 레이어 지정.
function buildEmissive(frame) {
  const res = state.res, g = state.glow;
  const fr = frame || curFrame();
  if (!_emCanvas) _emCanvas = document.createElement('canvas');
  const c = _emCanvas;
  if (c.width !== res || c.height !== res) { c.width = res; c.height = res; }
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(res, res);
  const d = id.data;
  const tint = g.tint ? hexToRgb(g.tint) : null;
  const src = g.source || 'emissive';
  const useEmissive = (src === 'emissive' || src === 'both');
  const useBright = (src === 'bright' || src === 'both');
  let any = false;
  const put = (i, rgb, a) => {
    const o = i * 4;
    if (a <= d[o + 3]) return;              // 이미 더 강한 값 있으면 유지(둘 다 모드)
    if (tint) { d[o] = tint[0]; d[o + 1] = tint[1]; d[o + 2] = tint[2]; }
    else { d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; }
    d[o + 3] = a; any = true;
  };
  // (1) 발광으로 지정한 레이어 — 밝기 무관, 전부 발광
  if (useEmissive) {
    for (const L of fr.layers) {
      if (!L.visible || !L.emissive) continue;
      const p = L.pixels;
      for (let i = 0; i < p.length; i++) {
        const hex = p[i]; if (!hex) continue;
        const rgb = hexToRgb(hex); if (!rgb) continue;
        put(i, rgb, 255);
      }
    }
  }
  // (2) 밝기 임계값 (옛 방식 — 옵션)
  if (useBright) {
    const flat = flattenFrame(fr);
    const th = g.threshold, denom = (1 - th) || 1;
    for (let i = 0; i < flat.length; i++) {
      const hex = flat[i]; if (!hex) continue;
      const rgb = hexToRgb(hex); if (!rgb) continue;
      const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      if (lum < th) continue;
      const w = (lum - th) / denom;
      put(i, rgb, Math.round(255 * Math.min(1, 0.55 + 0.45 * w)));
    }
  }
  if (!any) return null;
  ctx.putImageData(id, 0, 0);
  return c;
}

// 발광원을 흐리게 번지게 해 additive(lighter)로 대상 ctx에 합성
function compositeGlow(ctx, em, w, h) {
  const g = state.glow, res = state.res;
  const cellPx = w / res;
  const base = Math.max(0.5, g.radius * cellPx);
  const passes = [[base * 1.8, 0.45], [base, 0.85]];   // 넓은 헤일로 + 좁은 코어
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  for (const [r, a] of passes) {
    ctx.filter = 'blur(' + r + 'px)';
    ctx.globalAlpha = Math.min(1, a * g.intensity);
    ctx.drawImage(em, 0, 0, res, res, 0, 0, w, h);
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.restore();
}

// 실시간 미리보기 (render 끝에서 호출 — 꺼져 있으면 즉시 반환)
function render() {
  const cv = $('glowCanvas'); if (!cv) return;
  const g = state.glow;
  if (!g || !g.enabled) { cv.style.display = 'none'; return; }
  const res = state.res, disp = state.display;
  cv.style.display = 'block';
  if (cv.width !== disp) { cv.width = disp; cv.height = disp; }
  cv.style.width = disp + 'px'; cv.style.height = disp + 'px';
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, disp, disp);
  const em = buildEmissive(); if (!em) return;
  compositeGlow(ctx, em, disp, disp);
}

// 내보내기용: 이미 픽셀이 그려진 ctx 위에 글로우를 구움 (frameToCanvas에서 호출)
function bake(ctx, frame, scale) {
  const g = state.glow; if (!g || !g.enabled) return;
  const em = buildEmissive(frame); if (!em) return;
  compositeGlow(ctx, em, state.res * scale, state.res * scale);
}

function apply() { render(); if (typeof autoSave === 'function') autoSave(); }
function enable(on) { state.glow.enabled = !!on; syncBtn(); render(); }
function syncBtn() { const b = $('glowToggle'); if (b) b.classList.toggle('active', !!state.glow.enabled); }

// ---------- 설정 패널 ----------
function buildPanel() {
  const g = state.glow;
  const p = document.createElement('div');
  panelEl = p;
  p.style.cssText = 'position:fixed;z-index:80;width:230px;background:rgba(24,24,27,.98);border:1px solid #3f3f46;' +
    'border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.55);font-size:12px;color:#e4e4e7;user-select:none;';
  p.addEventListener('pointerdown', e => e.stopPropagation());

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  head.innerHTML = '<span style="font-weight:600">💡 글로우 / 조명</span>';
  const en = document.createElement('button');
  const setEnLabel = () => { en.textContent = state.glow.enabled ? '켜짐' : '꺼짐';
    en.style.background = state.glow.enabled ? '#4f46e5' : '#3f3f46'; en.style.color = '#fff'; };
  en.style.cssText = 'padding:3px 10px;border-radius:6px;font-weight:600;';
  en.addEventListener('click', () => { state.glow.enabled = !state.glow.enabled; setEnLabel(); syncBtn(); apply(); });
  setEnLabel();
  head.appendChild(en);
  p.appendChild(head);

  // 발광원 선택
  const srow = document.createElement('div'); srow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:6px 0;';
  const slab = document.createElement('span'); slab.textContent = '발광원'; slab.style.color = '#a1a1aa';
  const sel = document.createElement('select');
  sel.style.cssText = 'flex:1;background:#3f3f46;color:#e4e4e7;border-radius:6px;padding:3px 6px;';
  [['emissive', '발광 레이어(권장)'], ['bright', '밝기 임계값'], ['both', '둘 다']].forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; if ((state.glow.source || 'emissive') === v) o.selected = true; sel.appendChild(o);
  });
  const thWrap = { el: null };
  sel.addEventListener('change', () => { state.glow.source = sel.value; if (thWrap.el) thWrap.el.style.display = (sel.value === 'bright' || sel.value === 'both') ? '' : 'none'; render(); if (typeof autoSave === 'function') autoSave(); });
  srow.appendChild(slab); srow.appendChild(sel); p.appendChild(srow);
  const emNote = document.createElement('div');
  emNote.style.cssText = 'color:#71717a;font-size:11px;margin:-2px 0 4px;line-height:1.4;';
  emNote.textContent = '발광 레이어: 레이어 패널에서 💡를 켠 레이어만 빛납니다(산나비식 네온).';
  p.appendChild(emNote);

  const slider = (label, key, min, max, step, fmt) => {
    const row = document.createElement('div'); row.style.cssText = 'margin:8px 0;';
    const top = document.createElement('div'); top.style.cssText = 'display:flex;justify-content:space-between;color:#a1a1aa;margin-bottom:2px;';
    const nm = document.createElement('span'); nm.textContent = label;
    const vv = document.createElement('span'); vv.style.color = '#d4d4d8';
    top.appendChild(nm); top.appendChild(vv); row.appendChild(top);
    const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = state.glow[key]; r.style.width = '100%';
    const show = () => vv.textContent = fmt ? fmt(state.glow[key]) : state.glow[key];
    r.addEventListener('input', () => { state.glow[key] = parseFloat(r.value); show(); render(); });
    r.addEventListener('change', () => { if (typeof autoSave === 'function') autoSave(); });
    row.appendChild(r); show();
    p.appendChild(row);
    return row;
  };
  thWrap.el = slider('임계값 (밝기)', 'threshold', 0.1, 0.95, 0.01, v => Math.round(v * 100) + '%');
  thWrap.el.style.display = (sel.value === 'bright' || sel.value === 'both') ? '' : 'none';
  slider('세기', 'intensity', 0.1, 2, 0.05, v => v.toFixed(2) + '×');
  slider('번짐 (반경)', 'radius', 0.4, 8, 0.1, v => v.toFixed(1));

  // 색조
  const trow = document.createElement('div'); trow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;';
  const tlab = document.createElement('span'); tlab.textContent = '색조'; tlab.style.color = '#a1a1aa';
  const tchk = document.createElement('input'); tchk.type = 'checkbox'; tchk.checked = !!state.glow.tint;
  const tcol = document.createElement('input'); tcol.type = 'color'; tcol.value = state.glow.tint || '#66ccff'; tcol.disabled = !state.glow.tint;
  const applyTint = () => { state.glow.tint = tchk.checked ? tcol.value : null; tcol.disabled = !tchk.checked; render(); if (typeof autoSave === 'function') autoSave(); };
  tchk.addEventListener('change', applyTint);
  tcol.addEventListener('input', () => { if (tchk.checked) { state.glow.tint = tcol.value; render(); } });
  tcol.addEventListener('change', () => { if (typeof autoSave === 'function') autoSave(); });
  trow.appendChild(tlab); trow.appendChild(tchk); trow.appendChild(tcol);
  const thint = document.createElement('span'); thint.textContent = '(끄면 원래 색)'; thint.style.cssText = 'color:#71717a;font-size:11px;';
  trow.appendChild(thint);
  p.appendChild(trow);

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:10px;color:#71717a;font-size:11px;line-height:1.4;';
  note.textContent = '밝은 픽셀이 번져 빛납니다. 내보내기(PNG·시트·GIF)에도 그대로 구워져요.';
  p.appendChild(note);

  document.body.appendChild(p);
}
function positionPanel() {
  if (!panelEl) return;
  const btn = $('glowToggle');
  const r = btn ? btn.getBoundingClientRect() : { right: 60, top: 80 };
  panelEl.style.left = Math.min(r.right + 8, (window.innerWidth || 9999) - 250) + 'px';
  panelEl.style.top = Math.min(r.top, (window.innerHeight || 9999) - 320) + 'px';
}
function hidePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }
function togglePanel() {
  if (panelEl) { hidePanel(); return; }
  buildPanel(); positionPanel();
}

function init() {
  const btn = $('glowToggle');
  if (btn) btn.addEventListener('click', togglePanel);
  window.addEventListener('pointerdown', e => {
    if (panelEl && !panelEl.contains(e.target) && e.target !== $('glowToggle')) hidePanel();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hidePanel(); });
  window.addEventListener('resize', positionPanel);
  syncBtn();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

DF.Glow = { init, render, bake, enable, togglePanel, buildEmissive, compositeGlow };

})(window.DF);
