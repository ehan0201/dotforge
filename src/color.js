/* =====================================================================
   Dotforge — color.js
   색상 유틸(HSV↔HEX) + 현재색/색상판 + 팔레트 + 즐겨찾기 + 팔레트 세트(Palettes).
   REFACTOR.md 모듈 분리 2단계.

   의존: DF.state (state.js). 런타임에 인라인의 toast/setEraseMode를 window 전역으로 호출.
   state.js와 마찬가지로 index.html 인라인 <script>보다 먼저 로드
   (인라인 동기 시작 코드가 Palettes.init 등을 부름).
   ⚠ hexToRgb는 [r,g,b] 배열을 반환한다 (CLAUDE.md 함정).
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const state = DF.state;

// ---------- 색상 ----------
// ---------- 색상 유틸 (HSV ↔ HEX) ----------
function hsvToRgb(h, s, v) {
  h = (h % 360 + 360) % 360; s = Math.max(0,Math.min(1,s)); v = Math.max(0,Math.min(1,v));
  const c = v*s, x = c*(1-Math.abs((h/60)%2-1)), m = v-c;
  let r,g,b;
  if (h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function rgbToHsv(r,g,b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d){ if(max===r)h=((g-b)/d)%6; else if(max===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
  return [h, max?d/max:0, max];
}
function hexToRgb(hex){ hex=hex.replace('#',''); return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]; }
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }

// 현재 색을 설정 (fromPicker=true면 색상판 조작 중이라 커서 갱신 생략)
function setColor(hex, fromPicker) {
  hex = hex.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) return;
  state.color = hex;
  $('colorSwatch').style.background = hex;
  $('hexInput').value = hex.slice(1).toUpperCase();
  if (state.eraseMode && typeof setEraseMode === 'function') setEraseMode(false);  // 색을 고르면 지우기 해제
  if (!fromPicker) {
    // HEX/팔레트에서 온 경우 색상판 위치도 동기화
    const [h,s,v] = rgbToHsv(...hexToRgb(hex));
    if (s > 0.001) state.hue = h;   // 무채색이면 hue 유지
    state.sv = { s, v };
    updatePickerUI();
  }
}
// 색상판/슬라이더 UI 갱신
function updatePickerUI() {
  const svHueRgb = hsvToRgb(state.hue, 1, 1);
  $('svHue').style.background = rgbToHex(...svHueRgb);
  const box = $('svBox');
  $('svCursor').style.left = (state.sv.s * box.clientWidth) + 'px';
  $('svCursor').style.top = ((1 - state.sv.v) * box.clientHeight) + 'px';
  $('hueCursor').style.left = (state.hue / 360 * $('hueBar').clientWidth) + 'px';
}
// 색상판/슬라이더에서 현재 hue,sv로 색 확정
function applyPickerColor() {
  const [r,g,b] = hsvToRgb(state.hue, state.sv.s, state.sv.v);
  setColor(rgbToHex(r,g,b), true);
  updatePickerUI();
}

function pushPalette(hex) {
  hex = hex.toLowerCase();
  state.palette = state.palette.filter(c => c !== hex);
  state.palette.unshift(hex);
  if (state.palette.length > 16) state.palette.pop();
  renderPalette();
}
function renderPalette() {
  const el = $('palette'); el.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const c = state.palette[i];
    const sw = document.createElement('button');
    sw.className = 'aspect-square rounded border border-zinc-700/50 ' + (c ? 'cursor-pointer hover:scale-110 transition-transform' : 'bg-zinc-800/40');
    if (c) { sw.style.background = c; sw.onclick = () => setColor(c); }
    el.appendChild(sw);
  }
}

// ---------- 즐겨찾기 색상 (브라우저 저장) ----------
function loadFavorites() {
  try {
    const raw = localStorage.getItem('dotforge_favorites');
    if (raw) state.favorites = JSON.parse(raw);
  } catch (e) { /* 샌드박스에서 localStorage 불가 시 메모리만 사용 */ }
}
function saveFavorites() {
  try { localStorage.setItem('dotforge_favorites', JSON.stringify(state.favorites)); }
  catch (e) { /* 저장 불가: 이번 세션 메모리에만 유지 */ }
}
function addFavorite(hex) {
  hex = (hex || state.color).toLowerCase();
  if (state.favorites.filter(Boolean).includes(hex)) { toast('이미 즐겨찾기에 있습니다.'); return; }
  // 빈(null) 슬롯이 있으면 거기 채우고, 없으면 앞에 추가
  const nullIdx = state.favorites.indexOf(null);
  if (nullIdx >= 0) state.favorites[nullIdx] = hex;
  else state.favorites.unshift(hex);
  if (state.favorites.length > 32) state.favorites.length = 32;
  saveFavorites(); renderFavorites();
}
function removeFavorite(hex) {
  state.favorites = state.favorites.filter(c => c !== hex);
  saveFavorites(); renderFavorites();
}
// 즐겨찾기 n번 슬롯에 색을 직접 저장 (Ctrl+Shift+숫자)
function setFavSlot(n, hex) {
  hex = hex.toLowerCase();
  while (state.favorites.length <= n) state.favorites.push(null);
  state.favorites[n] = hex;
  saveFavorites(); renderFavorites();
}
function renderFavorites() {
  const el = $('favPalette'); if (!el) return;
  el.innerHTML = '';
  const list = state.favorites;
  if (!list.length) {
    const hint = document.createElement('div');
    hint.className = 'col-span-8 text-[10px] text-zinc-600 py-1.5 text-center';
    hint.textContent = '★ 버튼 또는 Alt+숫자로 저장';
    el.appendChild(hint); return;
  }
  list.forEach((c, i) => {
    const sw = document.createElement('button');
    sw.className = 'relative aspect-square rounded border border-zinc-700/50 ' + (c ? 'cursor-pointer hover:scale-110 transition-transform' : 'bg-zinc-800/40');
    if (c) {
      sw.style.background = c;
      sw.title = c.toUpperCase() + (i<9?` (Ctrl+${i+1})`:'') + ' · 우클릭 삭제';
      sw.onclick = () => setColor(c);
      sw.oncontextmenu = e => { e.preventDefault(); removeFavorite(c); };
    }
    // 앞 9개는 Ctrl+숫자 슬롯 번호 표시
    if (i < 9) {
      const num = document.createElement('span');
      num.className = 'absolute top-0 right-0.5 text-[8px] mono text-white/60 pointer-events-none';
      num.textContent = i+1;
      sw.appendChild(num);
    }
    el.appendChild(sw);
  });
}

// ---------- 팔레트 세트 시스템 ----------
/*
  여러 팔레트 세트를 만들어 저장하고, 드롭다운으로 골라 불러온다.
  - 내장(builtin) 세트: 유명 픽셀아트 팔레트, 읽기전용(복제해서 편집)
  - 사용자 세트: localStorage(dotforge_palettes) 저장, 편집 가능
*/
const Palettes = (function(){
  const okHex = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c.toLowerCase() : null;
  function cleanList(arr, max){
    const seen = new Set(), out = [];
    (Array.isArray(arr)?arr:[]).forEach(c=>{ const v=okHex(c); if(v && !seen.has(v)){ seen.add(v); out.push(v); } });
    return out.slice(0, max||64);
  }

  // 내장 세트 (읽기전용). 잘 알려진 오픈 팔레트 기반.
  const BUILTIN = [
    { id:'b_default', name:'기본 16색', builtin:true, colors:[
      '#000000','#ffffff','#ff0040','#ff8000','#ffe000','#40c000','#00c0a0','#0080ff',
      '#4040ff','#a000ff','#ff40c0','#804000','#808080','#c0c0c0','#404040','#202020'] },
    { id:'b_gameboy', name:'게임보이', builtin:true, colors:[
      '#0f380f','#306230','#8bac0f','#9bbc0f'] },
    { id:'b_pico8', name:'PICO-8 풍', builtin:true, colors:[
      '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8',
      '#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa'] },
    { id:'b_pastel', name:'파스텔', builtin:true, colors:[
      '#ffd1dc','#ffe4b5','#fdfd96','#b4f8c8','#a0e7e5','#b5b9ff','#e0b0ff','#ffc8dd'] },
    { id:'b_retro', name:'레트로 어스', builtin:true, colors:[
      '#2b2b26','#5c4033','#8a6642','#b08d57','#c9a66b','#d9c8a9','#6b7d4a','#3a4a3a',
      '#7a3b2e','#a5503a','#4a3a5a','#2e4a5a'] },
    { id:'b_grayscale', name:'그레이스케일', builtin:true, colors:[
      '#000000','#242424','#484848','#6d6d6d','#919191','#b6b6b6','#dadada','#ffffff'] },
  ];

  let userSets = [];      // [{id,name,colors}]
  let currentId = null;   // 선택된 세트 id

  function load(){
    try {
      const raw = localStorage.getItem('dotforge_palettes');
      if (raw){ const o = JSON.parse(raw); userSets = (o.sets||[]).map(s=>({ id:s.id||('u_'+Math.random().toString(36).slice(2,9)), name:String(s.name||'내 팔레트').slice(0,24), colors:cleanList(s.colors) })); currentId = o.currentId || null; }
    } catch(e){ userSets = []; }
    if (!allSets().some(s=>s.id===currentId)) currentId = BUILTIN[0].id;
  }
  function save(){
    try { localStorage.setItem('dotforge_palettes', JSON.stringify({ sets:userSets, currentId })); } catch(e){}
  }
  function allSets(){ return BUILTIN.concat(userSets); }
  function getSet(id){ return allSets().find(s=>s.id===id) || null; }
  function current(){ return getSet(currentId) || BUILTIN[0]; }
  function isBuiltin(id){ return BUILTIN.some(s=>s.id===id); }
  function newId(){ return 'u_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }

  // ----- 색상 탭: 드롭다운 + 스와치 -----
  function renderPicker(){
    const sel = $('paletteSelect'); if(!sel) return;
    sel.innerHTML = '';
    const mkOpt = (s, grp) => { const o=document.createElement('option'); o.value=s.id; o.textContent=(s.builtin?'◆ ':'')+s.name; return o; };
    const gB = document.createElement('optgroup'); gB.label='내장';
    BUILTIN.forEach(s=>gB.appendChild(mkOpt(s)));
    sel.appendChild(gB);
    if (userSets.length){
      const gU = document.createElement('optgroup'); gU.label='내 팔레트';
      userSets.forEach(s=>gU.appendChild(mkOpt(s)));
      sel.appendChild(gU);
    }
    sel.value = currentId;

    const sw = $('paletteSwatches'); sw.innerHTML='';
    const cols = current().colors;
    if (!cols.length){
      const hint=document.createElement('div');
      hint.className='col-span-8 text-[10px] text-zinc-600 py-1.5 text-center';
      hint.textContent='빈 팔레트 · 관리에서 색 추가';
      sw.appendChild(hint); return;
    }
    cols.forEach(c=>{
      const b=document.createElement('button');
      b.className='aspect-square rounded border border-zinc-700/50 cursor-pointer hover:scale-110 transition-transform';
      b.style.background=c; b.title=c.toUpperCase();
      b.onclick=()=>{ setColor(c); pushPalette(c); };
      sw.appendChild(b);
    });
  }

  // 현재 팔레트를 즐겨찾기로 채우기
  function loadToFavorites(){
    const cols = current().colors;
    if (!cols.length){ toast('빈 팔레트예요.'); return; }
    state.favorites = cols.slice(0, 32);
    saveFavorites(); renderFavorites();
    toast(`'${current().name}' → 즐겨찾기 ${state.favorites.length}색`);
  }

  // ----- 관리 모달 -----
  let editId = null;   // 관리 모달에서 편집 중인 세트 id
  function openManager(){
    editId = currentId;
    $('paletteModal').classList.remove('hidden'); $('paletteModal').classList.add('flex');
    renderManager();
  }
  function closeManager(){ $('paletteModal').classList.add('hidden'); $('paletteModal').classList.remove('flex'); }

  function renderManager(){
    const sel=$('pmSetSelect'); sel.innerHTML='';
    allSets().forEach(s=>{ const o=document.createElement('option'); o.value=s.id; o.textContent=(s.builtin?'◆ ':'')+s.name; sel.appendChild(o); });
    if (!getSet(editId)) editId = BUILTIN[0].id;
    sel.value=editId;
    const set=getSet(editId), ro=isBuiltin(editId);
    $('pmName').value=set.name; $('pmName').disabled=ro;
    $('pmDelBtn').disabled=ro; $('pmDelBtn').classList.toggle('opacity-40', ro);
    $('pmReadonly').classList.toggle('hidden', !ro);
    $('pmAddRow').classList.toggle('hidden', ro);
    $('pmCount').textContent = '('+set.colors.length+')';

    const sw=$('pmSwatches'); sw.innerHTML='';
    set.colors.forEach((c,i)=>{
      const b=document.createElement('button');
      b.className='relative aspect-square rounded border border-zinc-700/50 ' + (ro?'':'cursor-pointer hover:scale-105 transition-transform');
      b.style.background=c; b.title=c.toUpperCase()+(ro?'':' · 클릭:현재색으로 교체 · 우클릭:삭제');
      if (!ro){
        b.onclick=()=>{ // 현재 선택색으로 교체
          const cur=okHex(state.color); if(!cur){toast('현재 색이 유효하지 않아요.');return;}
          set.colors[i]=cur; save(); renderManager(); renderPicker();
        };
        b.oncontextmenu=e=>{ e.preventDefault(); set.colors.splice(i,1); save(); renderManager(); renderPicker(); };
      }
      sw.appendChild(b);
    });
    if (!set.colors.length){
      const hint=document.createElement('div');
      hint.className='col-span-8 text-[10px] text-zinc-600 py-2 text-center';
      hint.textContent = ro?'(빈 세트)':'아래에서 색을 추가하세요';
      sw.appendChild(hint);
    }
  }

  function addColor(hex){
    if (isBuiltin(editId)) return;
    const v=okHex(hex); if(!v){ toast('#RRGGBB 형식으로 입력하세요.'); return; }
    const set=getSet(editId);
    if (set.colors.includes(v)){ toast('이미 있는 색이에요.'); return; }
    if (set.colors.length>=64){ toast('한 세트당 최대 64색이에요.'); return; }
    set.colors.push(v); save(); renderManager(); renderPicker();
  }

  function createSet(name, colors){
    const s={ id:newId(), name:String(name||'새 팔레트').slice(0,24), colors:cleanList(colors) };
    userSets.push(s); editId=s.id; currentId=s.id; save();
    renderManager(); renderPicker(); return s;
  }

  function init(){
    load();
    renderPicker();
    // 색상 탭 컨트롤
    $('paletteSelect').addEventListener('change', e=>{ currentId=e.target.value; save(); renderPicker(); });
    $('paletteLoadFav').onclick = loadToFavorites;
    $('paletteManageBtn').onclick = openManager;
    // 관리 모달 컨트롤
    $('pmClose').onclick = closeManager;
    $('paletteModal').addEventListener('click', e=>{ if(e.target===$('paletteModal')) closeManager(); });
    $('pmSetSelect').addEventListener('change', e=>{ editId=e.target.value; renderManager(); });
    $('pmName').addEventListener('input', e=>{ if(isBuiltin(editId))return; getSet(editId).name=e.target.value.slice(0,24); save(); });
    $('pmName').addEventListener('blur', ()=>{ renderManager(); renderPicker(); });
    $('pmNewBtn').onclick = ()=>{ createSet('새 팔레트 '+(userSets.length+1), []); };
    $('pmDupBtn').onclick = ()=>{ const s=getSet(editId); createSet(s.name+' 복사', s.colors.slice()); };
    $('pmDelBtn').onclick = ()=>{
      if (isBuiltin(editId)) return;
      const s=getSet(editId);
      if (!confirm(`'${s.name}' 세트를 삭제할까요?`)) return;
      userSets = userSets.filter(x=>x.id!==editId);
      if (currentId===editId) currentId=BUILTIN[0].id;
      editId=BUILTIN[0].id; save(); renderManager(); renderPicker();
    };
    $('pmAddBtn').onclick = ()=>{ addColor($('pmAddHex').value.trim()); $('pmAddHex').value=''; };
    $('pmAddHex').addEventListener('keydown', e=>{ if(e.key==='Enter'){ addColor($('pmAddHex').value.trim()); $('pmAddHex').value=''; } });
    $('pmAddCur').onclick = ()=>{ addColor(state.color); };
  }

  return { init, renderPicker, createSet, loadToFavorites, get currentName(){return current().name;} };
})();

// ---------- 노출 ----------
const exported = {
  hsvToRgb, rgbToHsv, hexToRgb, rgbToHex,
  setColor, updatePickerUI, applyPickerColor, pushPalette, renderPalette,
  loadFavorites, saveFavorites, addFavorite, removeFavorite, setFavSlot, renderFavorites,
  Palettes,
};
Object.assign(DF, exported);
// 전환기 병행 노출 (전체 분리 완료 시 제거)
Object.assign(window, exported);

})(window.DF);
