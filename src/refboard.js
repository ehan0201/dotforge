/* =====================================================================
   Dotforge — refboard.js
   참고판(무드보드): 작업공간(canvasWrap)에 참고 이미지를 여러 장 자유 배치.
   기존 밑그림(state.ref)과 완전히 독립된 추가 레이어.

   - 이미지 여러 장 추가(버튼/드래그드롭), 드래그 이동, 모서리 리사이즈, 개별 투명도, 삭제, 맨앞으로.
   - 편집 모드 off → 레이어 pointer-events:none → 참고 이미지 위로 그대로 그릴 수 있음.
   - 위치/크기는 canvasWrap 대비 비율(fx/fy/fw) → 창 리사이즈·다른 화면·저장 왕복에 안전.
   - data URL만 사용(blob 금지). 직렬화는 DF.RefBoard.serialize()/restore()로 io가 사용.

   의존: DF.state. 런타임 bare: $, toast, autoSave (인라인). 자체 init(DOM 끝 로드 + 로비 감지).
   노출: DF.RefBoard.
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state } = DF;
const $ = (id) => document.getElementById(id);

let dragId = null, mode = null;       // mode: 'move' | 'resize'
let startX = 0, startY = 0, startFx = 0, startFy = 0, startFw = 0, startHpx = 0;

function wrapRect() {
  const w = $('canvasWrap');
  return w ? w.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
}

function tileHeightPx(b, W) {
  const widthPx = b.fw * W;
  const ar = (b.natW && b.natH) ? (b.natH / b.natW) : 1;
  return widthPx * ar;
}

// 한 타일의 위치/크기를 현재 wrap 크기에 맞춰 px로 반영
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
    const el = document.createElement('div');
    el.className = 'ref-tile';
    el.dataset.id = b.id;
    el.style.cssText = 'position:absolute;box-sizing:border-box;' +
      (edit ? 'cursor:move;outline:2px solid rgba(99,102,241,.9);outline-offset:0;' : '');
    el.style.zIndex = idx;             // 배열 순서 = 쌓임 (뒤쪽이 위)
    layoutTile(el, b, R);

    const img = document.createElement('img');
    img.src = b.src;
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;-webkit-user-drag:none;';
    el.appendChild(img);

    if (edit) {
      // 상단 컨트롤 바 (투명도/맨앞/삭제)
      const bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;left:0;top:-30px;display:flex;align-items:center;gap:6px;' +
        'background:rgba(24,24,27,.95);border:1px solid #3f3f46;border-radius:6px;padding:2px 6px;white-space:nowrap;';
      bar.addEventListener('pointerdown', e => e.stopPropagation());  // 바 조작은 드래그 아님

      const op = document.createElement('input');
      op.type = 'range'; op.min = '10'; op.max = '100'; op.value = Math.round(b.opacity * 100);
      op.style.width = '64px';
      op.title = '투명도';
      op.addEventListener('input', () => { b.opacity = Math.max(0.1, op.value / 100); el.style.opacity = b.opacity; });
      op.addEventListener('change', save);

      const front = document.createElement('button');
      front.textContent = '⤒'; front.title = '맨 앞으로';
      front.style.cssText = 'color:#d4d4d8;font-size:13px;line-height:1;padding:2px 4px;';
      front.addEventListener('click', () => { toFront(b.id); });

      const del = document.createElement('button');
      del.textContent = '✕'; del.title = '삭제';
      del.style.cssText = 'color:#f87171;font-size:12px;line-height:1;padding:2px 4px;';
      del.addEventListener('click', () => { remove(b.id); });

      bar.appendChild(op); bar.appendChild(front); bar.appendChild(del);
      el.appendChild(bar);

      // 우하단 리사이즈 핸들
      const h = document.createElement('div');
      h.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;' +
        'background:#6366f1;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;';
      h.addEventListener('pointerdown', e => beginDrag(e, b.id, 'resize'));
      el.appendChild(h);

      // 본체 드래그(이동)
      el.addEventListener('pointerdown', e => beginDrag(e, b.id, 'move'));
    }

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

function beginDrag(e, id, m) {
  if (!state.refBoardEdit) return;
  e.preventDefault(); e.stopPropagation();
  const b = state.refBoards.find(x => x.id === id); if (!b) return;
  dragId = id; mode = m;
  const R = wrapRect();
  startX = e.clientX; startY = e.clientY;
  startFx = b.fx; startFy = b.fy; startFw = b.fw; startHpx = tileHeightPx(b, R.width);
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
  } else { // resize — 폭만 조절, 높이는 비율 유지
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

// 이미지 추가. fx/fy 생략 시 중앙 부근에 살짝 계단식 배치.
function addImage(src, natW, natH, fx, fy) {
  const n = state.refBoards.length;
  const defFw = 0.26;
  if (fx == null) fx = 0.38 + (n % 5) * 0.03;
  if (fy == null) fy = 0.18 + (n % 5) * 0.03;
  const b = {
    id: ++state._refBoardSeq,
    src, natW: natW || 0, natH: natH || 0,
    fx, fy, fw: defFw, opacity: 1,
  };
  state.refBoards.push(b);
  render(); save();
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
function clearAll() { state.refBoards = []; render(); save(); }
function setEdit(on) { state.refBoardEdit = !!on; render(); }
function toggleEdit() { setEdit(!state.refBoardEdit); }

function save() { if (typeof autoSave === 'function') autoSave(); }

// 파일 → data URL → 이미지 크기 측정 후 추가
function readFiles(files, fx, fy) {
  const imgs = [...files].filter(f => /^image\//.test(f.type));
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

// ---------- 직렬화 (io에서 사용) ----------
function serialize() {
  return state.refBoards.map(b => ({
    src: b.src, natW: b.natW, natH: b.natH, fx: b.fx, fy: b.fy, fw: b.fw, opacity: b.opacity,
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
      state.refBoards.push({
        id: ++state._refBoardSeq,
        src: b.src,
        natW: num(b.natW, 0), natH: num(b.natH, 0),
        fx: num(b.fx, 0.4), fy: num(b.fy, 0.2),
        fw: Math.max(0.02, Math.min(2, num(b.fw, 0.26))),
        opacity: Math.max(0.1, Math.min(1, num(b.opacity, 1))),
      });
    });
  }
  render();
}

// ---------- 초기화 ----------
function init() {
  const addBtn = $('refBoardAdd'), editBtn = $('refBoardEditBtn'), file = $('refBoardFile'), wrap = $('canvasWrap');
  if (addBtn && file) {
    addBtn.addEventListener('click', () => { if (!state.refBoardEdit) setEdit(true); file.value = ''; file.click(); });
    file.addEventListener('change', () => readFiles(file.files));
  }
  if (editBtn) editBtn.addEventListener('click', toggleEdit);

  // 작업공간에 이미지 드래그&드롭 → 그 자리에 추가
  if (wrap) {
    wrap.addEventListener('dragover', e => {
      if (e.dataTransfer && [...e.dataTransfer.items].some(i => i.kind === 'file')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      }
    });
    wrap.addEventListener('drop', e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const R = wrapRect();
      const fx = (e.clientX - R.left) / R.width - 0.13;   // 드롭 지점이 대략 타일 중앙
      const fy = (e.clientY - R.top) / R.height - 0.05;
      readFiles(e.dataTransfer.files, fx, fy);
    });
  }

  // 창 크기 변경 시 비율대로 재배치
  window.addEventListener('resize', () => { if (state.refBoards.length) render(); });

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

DF.RefBoard = { init, render, addImage, remove, toFront, clearAll, setEdit, toggleEdit, serialize, restore, readFiles };

})(window.DF);
