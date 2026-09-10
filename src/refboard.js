/* =====================================================================
   Dotforge — refboard.js
   참고판(무드보드): 작업공간(canvasWrap)에 참고 이미지를 여러 장 자유 배치.
   기존 밑그림(state.ref)과 완전히 독립된 추가 레이어.

   - 이미지 여러 장: 버튼 추가 / 작업공간에 드래그드롭 / 클립보드 붙여넣기(Ctrl+V).
   - 드래그 이동, 모서리 리사이즈, 개별 투명도, 좌우반전, 고정(잠금), 삭제, 맨앞으로.
   - 우클릭 메뉴: 편집 모드와 무관하게 그림 위 우클릭 → 투명도/고정/반전/맨앞/삭제.
   - 편집 모드 off → 레이어 pointer-events:none → 참고 이미지 위로 그대로 그릴 수 있음.
   - 위치/크기는 canvasWrap 대비 비율(fx/fy/fw) → 창 리사이즈·다른 화면·저장 왕복에 안전.
   - data URL만 사용(blob 금지). gif는 <img>로 자동 재생됨. 직렬화는 DF.RefBoard.serialize()/restore().

   의존: DF.state. 런타임 bare: $, toast, autoSave (인라인). 자체 init.
   노출: DF.RefBoard.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state } = DF;
const $ = (id) => document.getElementById(id);

let dragId = null, mode = null;       // mode: 'move' | 'resize'
let startX = 0, startY = 0, startFx = 0, startFy = 0, startFw = 0;
let menuEl = null;                    // 우클릭 컨텍스트 메뉴
let _lastSyncFrame = -1;              // GIF 프레임 동기화 캐시

// ---------- GIF 디코드 / 프레임 동기화 ----------
// data URL(base64) → 원본 바이트
function dataURLToBytes(dataURL) {
  const comma = dataURL.indexOf(','); if (comma < 0) return null;
  const bin = atob(dataURL.slice(comma + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
// GIF를 프레임별 PNG data URL 배열로 디코드. WebCodecs ImageDecoder 사용, 없으면 null.
async function decodeGifFrames(dataURL) {
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const bytes = dataURLToBytes(dataURL); if (!bytes) return null;
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = Math.min(track ? track.frameCount : 1, 240);   // 과도한 메모리 방지 상한
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
// GIF 타일의 프레임을 (필요 시) 디코드해 b.frames에 채움
function ensureGifFrames(b) {
  if (!b.gif || b.frames || b._decoding) return;
  b._decoding = true;
  decodeGifFrames(b.src).then(fr => {
    b._decoding = false;
    if (fr && fr.length) { b.frames = fr; _lastSyncFrame = -1; render(); }
    else { b.playMode = 'play'; render();            // 디코드 불가 → 자동재생 폴백
           if (typeof toast === 'function') toast('이 브라우저에선 GIF 프레임 동기화가 안 돼 자동재생으로 넣었어요.'); }
  });
}
// 현재 표시할 이미지 src (GIF 동기화면 현재 프레임 칸, 아니면 원본)
function displaySrc(b) {
  if (b.gif && b.playMode === 'sync' && b.frames && b.frames.length) {
    const n = b.frames.length;
    return b.frames[((state.current % n) + n) % n];
  }
  return b.src;
}
// 프레임 이동 시 GIF 동기화 타일만 가볍게 갱신 (메인 render가 끝에서 호출)
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

function wrapRect() {
  const w = $('canvasWrap');
  return w ? w.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
}
function tileHeightPx(b, W) {
  const widthPx = b.fw * W;
  const ar = (b.natW && b.natH) ? (b.natH / b.natW) : 1;
  return widthPx * ar;
}
function layoutTile(el, b, R) {
  const W = R.width, H = R.height;
  el.style.left   = (b.fx * W) + 'px';
  el.style.top    = (b.fy * H) + 'px';
  el.style.width  = (b.fw * W) + 'px';
  el.style.height = tileHeightPx(b, W) + 'px';
  el.style.opacity = b.opacity;
}

// 참고판 전체를 다시 그림 (구조 변경 시에만 호출 — 메인 render와 분리)
function render() {
  const layer = $('refBoardLayer');
  if (!layer) return;
  const edit = state.refBoardEdit;
  layer.style.pointerEvents = edit ? 'auto' : 'none';
  layer.innerHTML = '';
  const R = wrapRect();

  state.refBoards.forEach((b, idx) => {
    const movable = edit && !b.locked;
    const el = document.createElement('div');
    el.className = 'ref-tile';
    el.dataset.id = b.id;
    el.style.cssText = 'position:absolute;box-sizing:border-box;' +
      (edit ? ('cursor:' + (movable ? 'move' : 'default') + ';outline:2px solid ' +
        (b.locked ? 'rgba(250,204,21,.9)' : 'rgba(99,102,241,.9)') + ';outline-offset:0;') : '');
    el.style.zIndex = idx;             // 배열 순서 = 쌓임 (뒤쪽이 위)
    layoutTile(el, b, R);

    const img = document.createElement('img');
    img.src = displaySrc(b);
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;-webkit-user-drag:none;' +
      (b.flipX ? 'transform:scaleX(-1);' : '');
    el.appendChild(img);

    // 잠금 배지 (편집 모드에서 표시)
    if (edit && b.locked) {
      const lk = document.createElement('div');
      lk.textContent = '🔒';
      lk.style.cssText = 'position:absolute;right:2px;top:2px;font-size:12px;line-height:1;filter:drop-shadow(0 1px 1px #000);';
      el.appendChild(lk);
    }

    if (movable) {
      // 우하단 리사이즈 핸들
      const h = document.createElement('div');
      h.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;' +
        'background:#6366f1;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;';
      h.addEventListener('pointerdown', e => beginDrag(e, b.id, 'resize'));
      el.appendChild(h);
      // 본체 드래그(이동)
      el.addEventListener('pointerdown', e => beginDrag(e, b.id, 'move'));
    }

    // 우클릭 메뉴 (편집 모드 여부와 무관. 아래 canvasWrap contextmenu에서도 잡지만,
    //  편집 모드로 타일이 이벤트를 먹을 때를 위해 여기도 달아둠)
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showTileMenu(b, e.clientX, e.clientY); });

    layer.appendChild(el);
  });

  // 미니 툴바 노출 + 개수/편집 상태 반영
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

// 좌표 아래에 있는 최상단 타일 찾기 (편집 모드와 무관하게 우클릭용)
function hitTest(clientX, clientY) {
  const R = wrapRect();
  const x = clientX - R.left, y = clientY - R.top;
  for (let i = state.refBoards.length - 1; i >= 0; i--) {   // 위(뒤쪽)부터
    const b = state.refBoards[i];
    const lx = b.fx * R.width, ly = b.fy * R.height;
    const w = b.fw * R.width, h = tileHeightPx(b, R.width);
    if (x >= lx && x <= lx + w && y >= ly && y <= ly + h) return b;
  }
  return null;
}

function beginDrag(e, id, m) {
  if (!state.refBoardEdit || e.button !== 0) return;   // 좌클릭만
  const b = state.refBoards.find(x => x.id === id); if (!b || b.locked) return;
  e.preventDefault(); e.stopPropagation();
  dragId = id; mode = m;
  const R = wrapRect();
  startX = e.clientX; startY = e.clientY;
  startFx = b.fx; startFy = b.fy; startFw = b.fw;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}
function onMove(e) {
  const b = state.refBoards.find(x => x.id === dragId); if (!b) return;
  const R = wrapRect();
  const dx = e.clientX - startX, dy = e.clientY - startY;
  if (mode === 'move') {
    b.fx = startFx + dx / R.width;
    b.fy = startFy + dy / R.height;
  } else {
    const newWpx = Math.max(24, startFw * R.width + dx);
    b.fw = newWpx / R.width;
  }
  const el = $('refBoardLayer').querySelector(`[data-id="${dragId}"]`);
  if (el) layoutTile(el, b, R);
}
function onUp() {
  window.removeEventListener('pointermove', onMove);
  dragId = null; mode = null;
  save();
}

// ---------- 우클릭 컨텍스트 메뉴 ----------
function hideMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showTileMenu(b, cx, cy) {
  hideMenu();
  const m = document.createElement('div');
  menuEl = m;
  m.style.cssText = 'position:fixed;z-index:80;min-width:160px;background:rgba(24,24,27,.97);' +
    'border:1px solid #3f3f46;border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);' +
    'font-size:12px;color:#e4e4e7;user-select:none;';
  m.style.left = Math.min(cx, (window.innerWidth || 9999) - 180) + 'px';
  m.style.top  = Math.min(cy, (window.innerHeight || 9999) - 220) + 'px';
  m.addEventListener('pointerdown', e => e.stopPropagation());
  m.addEventListener('contextmenu', e => e.preventDefault());

  // 투명도
  const orow = document.createElement('div');
  orow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;';
  const olab = document.createElement('span'); olab.textContent = '투명도'; olab.style.cssText = 'color:#a1a1aa;';
  const op = document.createElement('input');
  op.type = 'range'; op.min = '10'; op.max = '100'; op.value = Math.round(b.opacity * 100); op.style.flex = '1';
  op.addEventListener('input', () => {
    b.opacity = Math.max(0.1, op.value / 100);
    const el = $('refBoardLayer').querySelector(`[data-id="${b.id}"]`);
    if (el) el.style.opacity = b.opacity;
  });
  op.addEventListener('change', save);
  orow.appendChild(olab); orow.appendChild(op);
  m.appendChild(orow);

  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:#3f3f46;margin:4px 0;';
  m.appendChild(sep);

  const item = (label, fn) => {
    const it = document.createElement('button');
    it.textContent = label;
    it.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 8px;border-radius:5px;color:inherit;';
    it.addEventListener('mouseenter', () => it.style.background = '#3f3f46');
    it.addEventListener('mouseleave', () => it.style.background = 'transparent');
    it.addEventListener('click', () => { fn(); hideMenu(); });
    m.appendChild(it);
    return it;
  };
  item(b.locked ? '🔓 고정 해제' : '🔒 고정', () => toggleLock(b.id));
  item(b.flipX ? '↩ 좌우반전 해제' : '↔ 좌우반전', () => toggleFlip(b.id));
  if (b.gif) item(b.playMode === 'sync' ? '▶ 자동재생으로' : '⧗ 내 프레임에 동기화', () => togglePlayMode(b.id));
  item('⤒ 맨 앞으로', () => toFront(b.id));
  const del = item('✕ 삭제', () => remove(b.id));
  del.style.color = '#f87171';

  document.body.appendChild(m);
}

// 이미지 추가. fx/fy 생략 시 중앙 부근에 계단식 배치.
function addImage(src, natW, natH, fx, fy) {
  const n = state.refBoards.length;
  if (fx == null) fx = 0.38 + (n % 5) * 0.03;
  if (fy == null) fy = 0.18 + (n % 5) * 0.03;
  const gif = /^data:image\/gif/i.test(src);
  const b = {
    id: ++state._refBoardSeq,
    src, natW: natW || 0, natH: natH || 0,
    fx, fy, fw: 0.26, opacity: 1, locked: false, flipX: false,
    gif, frames: null, playMode: 'sync',    // gif면 기본 '내 프레임 동기화'(로토스코프)
  };
  state.refBoards.push(b);
  render(); save();
  if (gif) ensureGifFrames(b);
  return b;
}
function remove(id) {
  const i = state.refBoards.findIndex(x => x.id === id);
  if (i >= 0) { state.refBoards.splice(i, 1); render(); save(); }
}
function toFront(id) {
  const i = state.refBoards.findIndex(x => x.id === id);
  if (i >= 0) { const [b] = state.refBoards.splice(i, 1); state.refBoards.push(b); render(); save(); }
}
function toggleLock(id) {
  const b = state.refBoards.find(x => x.id === id);
  if (b) { b.locked = !b.locked; render(); save(); if (typeof toast === 'function') toast(b.locked ? '고정됨' : '고정 해제'); }
}
function toggleFlip(id) {
  const b = state.refBoards.find(x => x.id === id);
  if (b) { b.flipX = !b.flipX; render(); save(); }
}
function togglePlayMode(id) {
  const b = state.refBoards.find(x => x.id === id);
  if (!b || !b.gif) return;
  b.playMode = b.playMode === 'sync' ? 'play' : 'sync';
  if (b.playMode === 'sync') ensureGifFrames(b);
  _lastSyncFrame = -1;
  render(); save();
  if (typeof toast === 'function') toast(b.playMode === 'sync' ? 'GIF를 내 프레임에 동기화' : 'GIF 자동재생');
}
function clearAll() { state.refBoards = []; render(); save(); }
function setEdit(on) { state.refBoardEdit = !!on; render(); }
function toggleEdit() { setEdit(!state.refBoardEdit); }
function save() { if (typeof autoSave === 'function') autoSave(); }

// 파일/블롭 → data URL → 이미지 크기 측정 후 추가
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
        if (!state.refBoardEdit) setEdit(true);  // 추가 직후엔 편집 모드로(바로 배치)
      };
      im.onerror = () => { if (typeof toast === 'function') toast('이미지를 불러오지 못했어요.'); };
      im.src = rd.result;
    };
    rd.onerror = () => { if (typeof toast === 'function') toast('파일 읽기에 실패했어요.'); };
    rd.readAsDataURL(file);
  });
}

// 클립보드 붙여넣기 → 이미지가 있으면 화면 중앙 부근에 참고로 추가
function onPaste(e) {
  if (!state.started) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;  // 입력 중이면 무시
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
  if (!files.length) return;
  e.preventDefault();
  readFiles(files, 0.37, 0.25);
  if (typeof toast === 'function') toast('참고 이미지를 붙여넣었어요.');
}

// ---------- 직렬화 (io에서 사용) ----------
function serialize() {
  // 프레임(frames)은 저장하지 않음 — 원본 gif에서 불러올 때 재디코드(용량 절약)
  return state.refBoards.map(b => ({
    src: b.src, natW: b.natW, natH: b.natH, fx: b.fx, fy: b.fy, fw: b.fw,
    opacity: b.opacity, locked: !!b.locked, flipX: !!b.flipX, playMode: b.playMode,
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
      state.refBoards.push({
        id: ++state._refBoardSeq,
        src: b.src,
        natW: num(b.natW, 0), natH: num(b.natH, 0),
        fx: num(b.fx, 0.4), fy: num(b.fy, 0.2),
        fw: Math.max(0.02, Math.min(2, num(b.fw, 0.26))),
        opacity: Math.max(0.1, Math.min(1, num(b.opacity, 1))),
        locked: !!b.locked, flipX: !!b.flipX,
        gif, frames: null, playMode: b.playMode === 'play' ? 'play' : 'sync',
      });
    });
  }
  render();
  // gif 동기화 타일은 프레임 재디코드
  state.refBoards.forEach(b => { if (b.gif && b.playMode === 'sync') ensureGifFrames(b); });
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
    // 드래그&드롭
    wrap.addEventListener('dragover', e => {
      if (e.dataTransfer && [...e.dataTransfer.items].some(i => i.kind === 'file')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      }
    });
    wrap.addEventListener('drop', e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const R = wrapRect();
      const fx = (e.clientX - R.left) / R.width - 0.13;
      const fy = (e.clientY - R.top) / R.height - 0.05;
      readFiles(e.dataTransfer.files, fx, fy);
    });
    // 우클릭 메뉴 (편집 모드 off로 타일이 이벤트를 안 먹을 때도 좌표로 히트테스트)
    wrap.addEventListener('contextmenu', e => {
      const b = hitTest(e.clientX, e.clientY);
      if (b) { e.preventDefault(); showTileMenu(b, e.clientX, e.clientY); }
    });
  }

  // 클립보드 붙여넣기
  window.addEventListener('paste', onPaste);

  // 메뉴 닫기: 바깥 클릭 / ESC / 스크롤
  window.addEventListener('pointerdown', () => hideMenu());
  window.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });
  window.addEventListener('resize', () => { hideMenu(); if (state.refBoards.length) render(); });

  // 로비가 사라지면(에디터 시작) 미니 바 노출
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
  init, render, addImage, remove, toFront, toggleLock, toggleFlip, togglePlayMode,
  clearAll, setEdit, toggleEdit, serialize, restore, readFiles, hitTest, syncFrame, displaySrc,
};

})(window.DF);
