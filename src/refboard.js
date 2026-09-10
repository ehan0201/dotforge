/* =====================================================================
   Dotforge — refboard.js
   참고판(무드보드): 작업공간에 참고 이미지를 여러 장 자유 배치.
   기존 밑그림(state.ref)과 독립. 레이어는 canvasStage의 자식이라
   캔버스 줌/팬을 그대로 따라간다(크기 % 기준, overflow visible로 캔버스 밖 배치).

   - 추가: 버튼 / 드래그드롭 / 클립보드 붙여넣기(Ctrl+V).
   - 이동·리사이즈·투명도·좌우반전·고정(잠금)·삭제·맨앞으로 (우클릭 메뉴).
   - 고정: 해당 이미지만 이동/리사이즈 차단(pointer-events:none이라 화면/그리기는 막지 않음). 우클릭으로 해제.
   - 편집 off → 레이어 pointer-events:none → 이미지 위로 그대로 그림.
   - GIF: 프레임별 디코드(WebCodecs). 재생방식 = 동기화(내 프레임 따라 넘김) / 고정(한 프레임) / 자동재생.
          시작 프레임(startFrame) 지정 가능.
   - 스포이드+Shift: 이미지 위 색 추출(sampleColorAt) — tools.js picker에서 사용.
   - 좌표/크기는 canvasStage 대비 비율(fx/fy/fw). data URL만 사용.

   의존: DF.state. 런타임 bare: $, toast, autoSave. 노출: DF.RefBoard.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state } = DF;
const $ = (id) => document.getElementById(id);

let dragId = null, mode = null;       // 'move' | 'resize'
let startX = 0, startY = 0, startFx = 0, startFy = 0, startFw = 0;
let menuEl = null;
let _lastSyncFrame = -1;
let _sampleCanvas = null;             // 스포이드 샘플용 스크래치 캔버스

// 참고판 좌표 기준 = 캔버스(stage) 화면 사각형 (줌/팬 반영됨)
function stageRect() {
  const s = $('canvasStage');
  return s ? s.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
}
function aspect(b) { return (b.natW && b.natH) ? (b.natH / b.natW) : 1; }
// stage가 정사각(res×res)이므로 높이 비율 = fw * (natH/natW)
function heightFrac(b) { return b.fw * aspect(b); }

// 타일 배치: stage 대비 % → 줌(크기)·팬(translate)은 부모(stage)가 처리해 자동 추종
function layoutTile(el, b) {
  el.style.left   = (b.fx * 100) + '%';
  el.style.top    = (b.fy * 100) + '%';
  el.style.width  = (b.fw * 100) + '%';
  el.style.height = (heightFrac(b) * 100) + '%';
  el.style.opacity = b.opacity;
}

// ---------- GIF 디코드 / 프레임 ----------
function dataURLToBytes(dataURL) {
  const comma = dataURL.indexOf(','); if (comma < 0) return null;
  const bin = atob(dataURL.slice(comma + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function decodeGifFrames(dataURL) {
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const bytes = dataURLToBytes(dataURL); if (!bytes) return null;
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = Math.min(track ? track.frameCount : 1, 240);
    const out = [];
    const cv = document.createElement('canvas'); let ctx = null;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      if (!ctx) { cv.width = image.displayWidth || image.codedWidth; cv.height = image.displayHeight || image.codedHeight; ctx = cv.getContext('2d'); }
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(image, 0, 0);
      out.push(cv.toDataURL('image/png'));
      if (image.close) image.close();
    }
    if (dec.close) dec.close();
    return out.length ? out : null;
  } catch (e) { return null; }
}
function ensureGifFrames(b) {
  if (!b.gif || b.frames || b._decoding) return;
  b._decoding = true;
  decodeGifFrames(b.src).then(fr => {
    b._decoding = false;
    if (fr && fr.length) { b.frames = fr; _lastSyncFrame = -1; render(); }
    else { b.playMode = 'play'; render();
           if (typeof toast === 'function') toast('이 브라우저에선 GIF 프레임 제어가 안 돼 자동재생으로 넣었어요.'); }
  });
}
// 현재 표시할 src
function displaySrc(b) {
  if (b.gif && b.frames && b.frames.length && b.playMode !== 'play') {
    const n = b.frames.length;
    const off = b.startFrame || 0;
    const idx = b.playMode === 'still' ? off : (state.current + off);
    return b.frames[((idx % n) + n) % n];
  }
  return b.src;
}
// 프레임 이동 시 동기화 타일만 가볍게 갱신
function syncFrame() {
  const gifs = state.refBoards.filter(b => b.gif && b.playMode === 'sync' && b.frames && b.frames.length);
  if (!gifs.length) { _lastSyncFrame = state.current; return; }
  if (state.current === _lastSyncFrame) return;
  _lastSyncFrame = state.current;
  const layer = $('refBoardLayer'); if (!layer) return;
  gifs.forEach(b => {
    const el = layer.querySelector(`[data-id="${b.id}"]`);
    const img = el && el.querySelector('img');
    if (img) { const want = displaySrc(b); if (img.getAttribute('src') !== want) img.src = want; }
  });
}

// ---------- 렌더 ----------
function render() {
  const layer = $('refBoardLayer');
  if (!layer) return;
  const edit = state.refBoardEdit;
  layer.style.pointerEvents = edit ? 'auto' : 'none';
  layer.innerHTML = '';

  state.refBoards.forEach((b, idx) => {
    const movable = edit && !b.locked;
    const el = document.createElement('div');
    el.className = 'ref-tile';
    el.dataset.id = b.id;
    el.style.cssText = 'position:absolute;box-sizing:border-box;' +
      // 고정/비편집 타일은 pointer-events:none → 화면·그리기를 막지 않음
      'pointer-events:' + (movable ? 'auto' : 'none') + ';' +
      (edit ? ('cursor:' + (movable ? 'move' : 'default') + ';outline:2px solid ' +
        (b.locked ? 'rgba(250,204,21,.95)' : 'rgba(99,102,241,.9)') + ';') : '');
    el.style.zIndex = idx;
    layoutTile(el, b);

    const img = document.createElement('img');
    img.src = displaySrc(b);
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;-webkit-user-drag:none;' +
      (b.flipX ? 'transform:scaleX(-1);' : '');
    el.appendChild(img);

    if (edit && b.locked) {
      const lk = document.createElement('div');
      lk.textContent = '🔒';
      lk.style.cssText = 'position:absolute;right:2px;top:2px;font-size:12px;line-height:1;filter:drop-shadow(0 1px 1px #000);';
      el.appendChild(lk);
    }
    if (movable) {
      const h = document.createElement('div');
      h.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;' +
        'background:#6366f1;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;';
      h.addEventListener('pointerdown', e => beginDrag(e, b.id, 'resize'));
      el.appendChild(h);
      el.addEventListener('pointerdown', e => beginDrag(e, b.id, 'move'));
    }
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showTileMenu(b, e.clientX, e.clientY); });
    layer.appendChild(el);
  });

  const bar = $('refBoardBar');
  if (bar) {
    bar.classList.toggle('hidden', !state.started);
    bar.classList.toggle('flex', !!state.started);
    const cnt = $('refBoardCount');
    if (cnt) cnt.textContent = state.refBoards.length ? (state.refBoards.length + '장') : '';
    const eb = $('refBoardEditBtn');
    if (eb) {
      eb.classList.toggle('bg-indigo-600', edit);
      eb.classList.toggle('text-white', edit);
      eb.classList.toggle('bg-zinc-800', !edit);
      eb.classList.toggle('text-zinc-300', !edit);
    }
  }
}

// 좌표 아래 최상단 타일 (편집 모드 무관 — 우클릭/스포이드용)
function hitTest(clientX, clientY) {
  const R = stageRect();
  const fxp = (clientX - R.left) / R.width;
  const fyp = (clientY - R.top) / R.height;
  for (let i = state.refBoards.length - 1; i >= 0; i--) {
    const b = state.refBoards[i];
    if (fxp >= b.fx && fxp <= b.fx + b.fw && fyp >= b.fy && fyp <= b.fy + heightFrac(b)) return b;
  }
  return null;
}

// 이미지 위 한 점의 색 추출 (Shift+스포이드). 표시 중인 <img>를 그대로 캔버스에 그려 픽셀을 읽음.
function sampleColorAt(clientX, clientY) {
  const b = hitTest(clientX, clientY); if (!b) return null;
  try {
    const R = stageRect();
    let u = ((clientX - R.left) / R.width - b.fx) / b.fw;          // 타일 내 가로 비율
    let v = ((clientY - R.top) / R.height - b.fy) / heightFrac(b); // 세로 비율
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    if (b.flipX) u = 1 - u;                                        // 좌우반전 반영
    const layer = $('refBoardLayer');
    const el = layer && layer.querySelector(`[data-id="${b.id}"]`);
    const img = el && el.querySelector('img');
    if (!img || !img.naturalWidth) return null;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!_sampleCanvas) _sampleCanvas = document.createElement('canvas');
    const c = _sampleCanvas; c.width = iw; c.height = ih;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, iw, ih);
    ctx.drawImage(img, 0, 0, iw, ih);
    const px = Math.max(0, Math.min(iw - 1, Math.floor(u * iw)));
    const py = Math.max(0, Math.min(ih - 1, Math.floor(v * ih)));
    const d = ctx.getImageData(px, py, 1, 1).data;
    if (d[3] < 40) return null;
    return '#' + [d[0], d[1], d[2]].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

// ---------- 드래그/리사이즈 ----------
function beginDrag(e, id, m) {
  if (!state.refBoardEdit || e.button !== 0) return;
  const b = state.refBoards.find(x => x.id === id); if (!b || b.locked) return;
  e.preventDefault(); e.stopPropagation();
  dragId = id; mode = m;
  startX = e.clientX; startY = e.clientY;
  startFx = b.fx; startFy = b.fy; startFw = b.fw;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}
function onMove(e) {
  const b = state.refBoards.find(x => x.id === dragId); if (!b) return;
  const R = stageRect();
  const dx = e.clientX - startX, dy = e.clientY - startY;
  if (mode === 'move') {
    b.fx = startFx + dx / R.width;
    b.fy = startFy + dy / R.height;
  } else {
    b.fw = Math.max(0.02, startFw + dx / R.width);
  }
  const el = $('refBoardLayer').querySelector(`[data-id="${dragId}"]`);
  if (el) layoutTile(el, b);
}
function onUp() {
  window.removeEventListener('pointermove', onMove);
  dragId = null; mode = null;
  save();
}

// ---------- 우클릭 메뉴 ----------
function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showTileMenu(b, cx, cy) {
  hideMenu();
  const m = document.createElement('div');
  menuEl = m;
  m.style.cssText = 'position:fixed;z-index:80;min-width:180px;background:rgba(24,24,27,.97);' +
    'border:1px solid #3f3f46;border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);' +
    'font-size:12px;color:#e4e4e7;user-select:none;';
  m.style.left = Math.min(cx, (window.innerWidth || 9999) - 200) + 'px';
  m.style.top  = Math.min(cy, (window.innerHeight || 9999) - 300) + 'px';
  m.addEventListener('pointerdown', e => e.stopPropagation());
  m.addEventListener('contextmenu', e => e.preventDefault());

  const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:#3f3f46;margin:4px 0;'; m.appendChild(s); };
  const row = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;'; m.appendChild(r); return r; };
  const item = (label, fn, color) => {
    const it = document.createElement('button');
    it.textContent = label;
    it.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 8px;border-radius:5px;color:' + (color || 'inherit') + ';';
    it.addEventListener('mouseenter', () => it.style.background = '#3f3f46');
    it.addEventListener('mouseleave', () => it.style.background = 'transparent');
    it.addEventListener('click', () => { fn(); });
    m.appendChild(it);
    return it;
  };

  // 투명도
  const orow = row();
  const olab = document.createElement('span'); olab.textContent = '투명도'; olab.style.color = '#a1a1aa';
  const op = document.createElement('input');
  op.type = 'range'; op.min = '10'; op.max = '100'; op.value = Math.round(b.opacity * 100); op.style.flex = '1';
  op.addEventListener('input', () => {
    b.opacity = Math.max(0.1, op.value / 100);
    const el = $('refBoardLayer').querySelector(`[data-id="${b.id}"]`);
    if (el) el.style.opacity = b.opacity;
  });
  op.addEventListener('change', save);
  orow.appendChild(olab); orow.appendChild(op);

  // GIF: 재생방식 + 시작 프레임
  if (b.gif) {
    sep();
    const mk = (label, modeName) => {
      const on = b.playMode === modeName;
      item((on ? '● ' : '○ ') + label, () => { setPlayMode(b.id, modeName); showTileMenu(b, cx, cy); });
    };
    mk('⧗ 내 프레임에 동기화', 'sync');
    mk('⏸ 고정 프레임', 'still');
    mk('▶ 자동재생', 'play');
    if (b.playMode !== 'play') {
      const frow = row();
      const flab = document.createElement('span');
      if (b.frames && b.frames.length) {
        flab.textContent = '시작'; flab.style.color = '#a1a1aa';
        const fr = document.createElement('input');
        fr.type = 'range'; fr.min = '0'; fr.max = String(b.frames.length - 1); fr.value = String(b.startFrame || 0); fr.style.flex = '1';
        const num = document.createElement('span'); num.textContent = (b.startFrame || 0) + '/' + (b.frames.length - 1); num.style.cssText = 'color:#d4d4d8;min-width:38px;text-align:right;';
        fr.addEventListener('input', () => {
          b.startFrame = parseInt(fr.value) || 0;
          num.textContent = b.startFrame + '/' + (b.frames.length - 1);
          _lastSyncFrame = -1;
          const el = $('refBoardLayer').querySelector(`[data-id="${b.id}"]`);
          const img = el && el.querySelector('img'); if (img) img.src = displaySrc(b);
        });
        fr.addEventListener('change', save);
        frow.appendChild(flab); frow.appendChild(fr); frow.appendChild(num);
      } else {
        flab.textContent = 'GIF 디코딩 중…'; flab.style.color = '#a1a1aa'; frow.appendChild(flab);
      }
    }
  }

  sep();
  item(b.locked ? '🔓 고정 해제' : '🔒 고정', () => { toggleLock(b.id); hideMenu(); });
  item(b.flipX ? '↩ 좌우반전 해제' : '↔ 좌우반전', () => { toggleFlip(b.id); hideMenu(); });
  item('⤒ 맨 앞으로', () => { toFront(b.id); hideMenu(); });
  item('✕ 삭제', () => { remove(b.id); hideMenu(); }, '#f87171');

  document.body.appendChild(m);
}

// ---------- CRUD ----------
function addImage(src, natW, natH, fx, fy) {
  const n = state.refBoards.length;
  if (fx == null) fx = 0.38 + (n % 5) * 0.03;
  if (fy == null) fy = 0.18 + (n % 5) * 0.03;
  const gif = /^data:image\/gif/i.test(src);
  const b = {
    id: ++state._refBoardSeq,
    src, natW: natW || 0, natH: natH || 0,
    fx, fy, fw: 0.26, opacity: 1, locked: false, flipX: false,
    gif, frames: null, playMode: 'sync', startFrame: 0,
  };
  state.refBoards.push(b);
  render(); save();
  if (gif) ensureGifFrames(b);
  return b;
}
function remove(id) { const i = state.refBoards.findIndex(x => x.id === id); if (i >= 0) { state.refBoards.splice(i, 1); render(); save(); } }
function toFront(id) { const i = state.refBoards.findIndex(x => x.id === id); if (i >= 0) { const [b] = state.refBoards.splice(i, 1); state.refBoards.push(b); render(); save(); } }
function toggleLock(id) { const b = state.refBoards.find(x => x.id === id); if (b) { b.locked = !b.locked; render(); save(); if (typeof toast === 'function') toast(b.locked ? '고정됨 (이 이미지만 잠금)' : '고정 해제'); } }
function toggleFlip(id) { const b = state.refBoards.find(x => x.id === id); if (b) { b.flipX = !b.flipX; render(); save(); } }
function setPlayMode(id, pm) {
  const b = state.refBoards.find(x => x.id === id);
  if (!b || !b.gif) return;
  b.playMode = (pm === 'play' || pm === 'still' || pm === 'sync') ? pm : 'sync';
  if (b.playMode !== 'play') ensureGifFrames(b);
  _lastSyncFrame = -1; render(); save();
}
function clearAll() { state.refBoards = []; render(); save(); }
function setEdit(on) { state.refBoardEdit = !!on; render(); }
function toggleEdit() { setEdit(!state.refBoardEdit); }
function save() { if (typeof autoSave === 'function') autoSave(); }

function readFiles(files, fx, fy) {
  const imgs = [...files].filter(f => f && /^image\//.test(f.type));
  if (!imgs.length) return;
  imgs.forEach((file, k) => {
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        const ofx = fx == null ? null : fx + k * 0.02;
        const ofy = fy == null ? null : fy + k * 0.02;
        addImage(rd.result, im.naturalWidth, im.naturalHeight, ofx, ofy);
        if (!state.refBoardEdit) setEdit(true);
      };
      im.onerror = () => { if (typeof toast === 'function') toast('이미지를 불러오지 못했어요.'); };
      im.src = rd.result;
    };
    rd.onerror = () => { if (typeof toast === 'function') toast('파일 읽기에 실패했어요.'); };
    rd.readAsDataURL(file);
  });
}
function onPaste(e) {
  if (!state.started) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
  if (!files.length) return;
  e.preventDefault();
  readFiles(files, 0.37, 0.25);
  if (typeof toast === 'function') toast('참고 이미지를 붙여넣었어요.');
}

// ---------- 직렬화 ----------
function serialize() {
  return state.refBoards.map(b => ({
    src: b.src, natW: b.natW, natH: b.natH, fx: b.fx, fy: b.fy, fw: b.fw,
    opacity: b.opacity, locked: !!b.locked, flipX: !!b.flipX,
    playMode: b.playMode, startFrame: b.startFrame || 0,
  }));
}
function restore(arr) {
  state.refBoards = [];
  state._refBoardSeq = 0;
  state.refBoardEdit = false;
  if (Array.isArray(arr)) {
    arr.slice(0, 40).forEach(b => {
      if (!b || typeof b.src !== 'string' || !/^data:image\//.test(b.src)) return;
      const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
      const gif = /^data:image\/gif/i.test(b.src);
      const pm = (b.playMode === 'play' || b.playMode === 'still' || b.playMode === 'sync') ? b.playMode : 'sync';
      state.refBoards.push({
        id: ++state._refBoardSeq,
        src: b.src,
        natW: num(b.natW, 0), natH: num(b.natH, 0),
        fx: num(b.fx, 0.4), fy: num(b.fy, 0.2),
        fw: Math.max(0.02, Math.min(2, num(b.fw, 0.26))),
        opacity: Math.max(0.1, Math.min(1, num(b.opacity, 1))),
        locked: !!b.locked, flipX: !!b.flipX,
        gif, frames: null, playMode: pm, startFrame: Math.max(0, num(b.startFrame, 0)),
      });
    });
  }
  render();
  state.refBoards.forEach(b => { if (b.gif && b.playMode !== 'play') ensureGifFrames(b); });
}

// ---------- 초기화 ----------
function init() {
  const addBtn = $('refBoardAdd'), editBtn = $('refBoardEditBtn'), file = $('refBoardFile'), wrap = $('canvasWrap');
  if (addBtn && file) {
    addBtn.addEventListener('click', () => { if (!state.refBoardEdit) setEdit(true); file.value = ''; file.click(); });
    file.addEventListener('change', () => readFiles(file.files));
  }
  if (editBtn) editBtn.addEventListener('click', toggleEdit);

  if (wrap) {
    wrap.addEventListener('dragover', e => {
      if (e.dataTransfer && [...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    wrap.addEventListener('drop', e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const R = stageRect();
      const fx = (e.clientX - R.left) / R.width - 0.13;
      const fy = (e.clientY - R.top) / R.height - 0.05;
      readFiles(e.dataTransfer.files, fx, fy);
    });
    wrap.addEventListener('contextmenu', e => {
      const b = hitTest(e.clientX, e.clientY);
      if (b) { e.preventDefault(); showTileMenu(b, e.clientX, e.clientY); }
    });
  }

  window.addEventListener('paste', onPaste);
  window.addEventListener('pointerdown', () => hideMenu());
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });
  window.addEventListener('resize', () => { hideMenu(); });

  const lobby = $('lobby');
  if (lobby && 'MutationObserver' in window) {
    const mo = new MutationObserver(() => {
      const hidden = lobby.style.display === 'none' || lobby.offsetParent === null;
      if (hidden && !state.started) state.started = true;
      render();
    });
    mo.observe(lobby, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

DF.RefBoard = {
  init, render, addImage, remove, toFront, toggleLock, toggleFlip, setPlayMode,
  clearAll, setEdit, toggleEdit, serialize, restore, readFiles, hitTest, syncFrame, displaySrc, sampleColorAt,
};

})(window.DF);
