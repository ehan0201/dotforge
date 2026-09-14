/* =====================================================================
   Dotforge — tools.js
   그리기 도구 전체: 펜/지우개/스포이드/페인트통/셰이딩/라인/도형/선택/마법봉/부분도트화.
   REFACTOR.md 모듈 분리 4단계.

   의존:
   - DF: state, curPixels, curFrame, makeLayer, flattenFrame, pushUndo, render,
         setColor, pushPalette, hexToRgb, rgbToHex (state/color/render.js, 먼저 로드)
   - 런타임 bare(인라인/ui, 호출 시점 전역 해소): $, mainCtx, gridCtx, toast,
         selectTool, renderLayerList
   노출: DF + window 병행(전환기).
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

const { state, curPixels, curFrame, makeLayer, flattenFrame, pushUndo, render,
        setColor, pushPalette, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } = DF;

// 지금 칠할 값: 지우기 모드거나 지우개 도구면 투명(null), 아니면 현재 색
function paintValue() {
  return (state.eraseMode || state.tool === 'eraser') ? null : state.color;
}
function applyTool(cell) {
  if (!cell) return;
  const f = curPixels();   // 활성 레이어의 픽셀
  switch (state.tool) {
    case 'pen':    paintCell(cell); break;
    case 'eraser': paintCell(cell); break;
    case 'shade':  shadeCell(cell); break;
    case 'wand':   magicWandSelect(cell); return;
    case 'picker': {
      let picked = null;
      // Shift: 참고판 이미지 위라면 그 색을 최우선 추출 (셀 중심의 화면 좌표로 샘플)
      if (state.shiftHeld && window.DF && DF.RefBoard && DF.RefBoard.sampleColorAt) {
        const rect = mainCanvas.getBoundingClientRect();
        const sx = rect.left + (cell.x + 0.5) / state.res * rect.width;
        const sy = rect.top  + (cell.y + 0.5) / state.res * rect.height;
        picked = DF.RefBoard.sampleColorAt(sx, sy);
      }
      // Shift + 레퍼런스(밑그림) 표시 중이면 밑그림 색 추출
      if (!picked && state.shiftHeld && state.refVisible && $('refImage').dataset.src) {
        picked = sampleRefColor(cell.x, cell.y);
      }
      // 다음: Shift면 직전 프레임 합성색
      if (!picked && state.shiftHeld && state.current > 0) {
        const prev = flattenFrame(state.frames[state.current - 1]);
        if (prev[cell.i]) picked = prev[cell.i];
      }
      if (!picked) {
        const flat = flattenFrame(curFrame());
        if (flat[cell.i]) picked = flat[cell.i];
      }
      if (picked) {
        setColor(picked);
        pushPalette(picked);
        if (!state.shiftHeld && state.autoReturnPen && state.prevTool && state.prevTool !== 'picker') {
          selectTool(state.prevTool);
        }
      }
      return;
    }
    case 'bucket': bucketFill(f, cell.x, cell.y, f[cell.i], paintValue()); break;
  }
  render();
}

// 레퍼런스 밑그림에서 셀 위치의 색을 추출 (object-fit:contain 반영)
let _refSampleCanvas = null, _refSampleImg = null, _refSampleSrc = null, _refFullData = null, _refFullDim = null;
// 클릭한 도트(cellX,cellY)가 밑그림 원본의 어느 영역에 대응하는지 역산해,
// 그 영역의 픽셀 평균색을 뽑는다. (축소 뭉개짐 없이 실제 보이는 색과 일치)
function sampleRefColor(cellX, cellY) {
  const el = $('refImage');
  const src = el.dataset.src; if (!src) return null;
  if (_refSampleSrc !== src) { _refSampleImg = new Image(); _refSampleImg.src = src; _refSampleSrc = src; _refFullData = null; }
  const img = _refSampleImg;
  const iw = img.naturalWidth, ih = img.naturalHeight; if (!iw || !ih) return null;
  const res = state.res, r = state.ref;

  // 원본 전체 픽셀 데이터를 한 번만 읽어 캐시
  if (!_refFullData) {
    try {
      const fc = document.createElement('canvas'); fc.width = iw; fc.height = ih;
      const fctx = fc.getContext('2d', { willReadFrequently: true });
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(img, 0, 0);
      _refFullData = fctx.getImageData(0,0,iw,ih).data; _refFullDim = { iw, ih };
    } catch(e) { return null; }
  }
  const data = _refFullData;

  // 화면에서 도트 하나가 차지하는 사각형(res 격자) → 원본 좌표계로 역매핑
  // applyRefTransform과 동일한 배치 계산.
  let srcX0, srcY0, srcW, srcH, dx, dy, dw, dh; // dx..: 화면(res)상 이미지가 그려진 사각형
  const stage = $('canvasStage').getBoundingClientRect();
  const offXr = stage.width ? r.offsetX / stage.width * res : 0;
  const offYr = stage.height ? r.offsetY / stage.height * res : 0;
  if (r.sheet && r.sheet.cols > 0 && r.sheet.rows > 0) {
    const cols = r.sheet.cols, rows = r.sheet.rows;
    const idx = Math.min(state.current, cols*rows - 1);
    const cx = idx % cols, cy = Math.floor(idx / cols);
    const cw = iw / cols, ch = ih / rows;
    const s = Math.min(res / cw, res / ch) * r.scale;
    dw = cw * s; dh = ch * s;
    dx = (res - dw)/2 + offXr; dy = (res - dh)/2 + offYr;
    srcX0 = cx*cw; srcY0 = cy*ch; srcW = cw; srcH = ch;   // 원본에서 이 칸 영역
  } else {
    const s = Math.min(res/iw, res/ih) * r.scale;
    dw = iw*s; dh = ih*s;
    dx = (res-dw)/2 + offXr; dy = (res-dh)/2 + offYr;
    srcX0 = 0; srcY0 = 0; srcW = iw; srcH = ih;
  }
  // 클릭한 도트(cellX,cellY)가 그려진 이미지 사각형 안에서 차지하는 비율(0~1)
  // 클릭한 도트의 중심(cellX+0.5, cellY+0.5)에 해당하는 원본 픽셀 하나를 그대로 뽑는다.
  // (평균 X — 원본에 실제 존재하는 색만 추출)
  const uc = (cellX + 0.5 - dx) / dw;   // 이미지 사각형 안 비율 0~1
  const vc = (cellY + 0.5 - dy) / dh;
  if (uc < 0 || uc >= 1 || vc < 0 || vc >= 1) return null;  // 이미지 밖
  const ox = Math.max(0, Math.min(_refFullDim.iw - 1, Math.floor(srcX0 + uc * srcW)));
  const oy = Math.max(0, Math.min(_refFullDim.ih - 1, Math.floor(srcY0 + vc * srcH)));
  const i = (oy * _refFullDim.iw + ox) * 4;
  if (data[i+3] < 40) return null;   // 투명 지점은 추출 안 함
  return '#'+[data[i], data[i+1], data[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// 한 픽셀에 값 설정 (미러 위치도 함께). 도형/펜 공용 저수준 함수
function setPixelMirrored(f, x, y, val) {
  const res = state.res;
  const put = (px, py) => { if (px>=0 && py>=0 && px<res && py<res) f[py*res+px] = val; };
  put(x, y);
  if (state.mirrorX) put(res - 1 - x, y);
  if (state.mirrorY) put(x, res - 1 - y);
  if (state.mirrorX && state.mirrorY) put(res - 1 - x, res - 1 - y);
}

// 펜/지우개용: 브러시 크기(size×size)만큼 활성 레이어에 칠함 (render 없이)
function paintCell(cell) {
  if (!cell) return;
  const f = curPixels();
  const val = paintValue();
  const s = state.brushSize;
  const off = Math.floor((s - 1) / 2);
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) {
      setPixelMirrored(f, cell.x - off + dx, cell.y - off + dy, val);
    }
}

// ---------- 셰이딩(명암) 도구 ----------
// 브러시 중심에서의 거리에 따라 원형으로 명도를 조절.
// outer: 바깥일수록 어두움(중심이 밝게 남음) / inner: 중심일수록 어두움
// 기존에 색이 있는 픽셀만 대상. 세기(shadeStrength)로 약하게 조절.
function shadeCell(cell) {
  if (!cell) return;
  const f = curPixels(), res = state.res;
  const radius = Math.max(1, state.brushSize);   // 브러시 크기 = 반경(칸)
  const cx = cell.x, cy = cell.y;
  const strength = Math.max(1, Math.min(100, state.shadeStrength)) / 100;
  const lighten = state.shadeLighten;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= res || y >= res) continue;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > radius) continue;                 // 원 바깥은 제외
      const i = y*res + x;
      const cur = f[i]; if (!cur) continue;         // 색 있는 곳만
      // 거리 비율 0(중심)~1(가장자리)
      const t = dist / radius;
      // 원형 감쇠(부드러운 가장자리): 중심 1 → 가장자리 0
      const falloff = Math.cos(t * Math.PI / 2);   // 1 → 0
      // 모드별 가중치
      let w;
      if (state.shadeMode === 'inner') w = falloff;        // 중심이 강함
      else w = 1 - falloff;                                 // 바깥이 강함
      const amount = strength * w;
      if (amount <= 0.001) continue;
      const delta = lighten ? amount : -amount;
      f[i] = state.shadeHue ? hueShiftShade(cur, delta, state.shadeHueAmount) : adjustBrightness(cur, delta);
    }
  }
}
// 휴 시프트 명암(하이비트식): 어둡게 하면 색조를 차가운 쪽(파랑~보라), 밝게 하면 따뜻한 쪽(노랑~주황)으로.
// delta: 음수=그림자, 양수=하이라이트 (절대값 0~1). amtDeg: 최대 색조 이동 각도.
function hueShiftShade(hex, delta, amtDeg) {
  const rgb = hexToRgb(hex); if (!rgb) return hex;
  let [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  const amt = Math.min(1, Math.abs(delta));
  const maxDeg = (typeof amtDeg === 'number' ? amtDeg : 28);
  // 목표 색조로 회전(최단 경로), 최대 maxDeg*amt 만큼
  const rotateToward = (cur, target, step) => {
    let d = ((target - cur + 540) % 360) - 180;      // -180~180
    d = Math.max(-step, Math.min(step, d));
    return (cur + d + 360) % 360;
  };
  if (delta < 0) {          // 그림자: 차갑게 + 어둡게 + 살짝 채도↑
    h = rotateToward(h, 240, maxDeg * amt);
    v = v * (1 - 0.85 * amt);
    s = Math.min(1, s + 0.12 * amt);
  } else {                  // 하이라이트: 따뜻하게 + 밝게 + 살짝 채도↓
    h = rotateToward(h, 50, maxDeg * amt);
    v = v + (1 - v) * 0.85 * amt;
    s = Math.max(0, s - 0.12 * amt);
  }
  const out = hsvToRgb(h, s, v);
  return rgbToHex(out[0], out[1], out[2]);
}
// 색의 명도를 delta(-1~1)만큼 조절 (곱셈 기반이라 자연스러움)
function adjustBrightness(hex, delta) {
  const rgb = hexToRgb(hex); if (!rgb) return hex;
  let [r,g,b] = rgb;
  if (delta < 0) {
    // 어둡게: 곱셈
    const k = 1 + delta;   // delta -0.1 → 0.9배
    r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
  } else {
    // 밝게: 흰색 쪽으로 보간
    r = Math.round(r + (255 - r) * delta);
    g = Math.round(g + (255 - g) * delta);
    b = Math.round(b + (255 - b) * delta);
  }
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return rgbToHex(r, g, b);
}

// 림라이트: 광원 방향의 가장자리 픽셀을 밝게(자동=따뜻한 하이라이트, 또는 지정색)
const RIM_DIRS = { TL:[-1,-1], T:[0,-1], TR:[1,-1], L:[-1,0], R:[1,0], BL:[-1,1], B:[0,1], BR:[1,1] };
function rimLightApply() {
  const f = curPixels(), res = state.res;
  const dir = RIM_DIRS[state.rimDir] || RIM_DIRS.TL;
  const lx = dir[0], ly = dir[1];
  const th = Math.max(1, Math.min(4, state.rimThickness || 1));
  // 광원 방향으로 th칸 안에 빈칸/경계가 있으면 가장자리(림)
  const targets = [];
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const i = y * res + x; if (!f[i]) continue;
    let edge = false;
    for (let t = 1; t <= th; t++) {
      const nx = x + lx * t, ny = y + ly * t;
      if (nx < 0 || ny < 0 || nx >= res || ny >= res || !f[ny * res + nx]) { edge = true; break; }
    }
    if (edge) {
      const col = state.rimAuto ? hueShiftShade(f[i], 0.9, state.shadeHueAmount) : state.rimColor;
      targets.push([i, col]);
    }
  }
  if (!targets.length) { if (typeof toast === 'function') toast('림라이트를 적용할 그림이 이 레이어에 없어요.'); return; }
  pushUndo();
  for (const [i, col] of targets) f[i] = col;
  render(); renderLayerList();
  if (typeof toast === 'function') toast(`림라이트 적용 (${targets.length}칸, 광원 ${state.rimDir}).`);
}

// 두 칸(from → to) 사이를 빈틈없이 칠함 (Bresenham 직선 알고리즘)
// 빠르게 그어 점이 띄엄띄엄 찍히는 것 방지
function paintLine(from, to) {
  let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    paintCell({ x: x0, y: y0, i: y0 * state.res + x0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
  render();
}
function bucketFill(f, sx, sy, target, replace) {
  if (target === replace) return;
  const tol = state.bucketTol || 0;
  const tc = target ? hexToRgb(target) : null;
  // 유사 판정: tol=0이면 완전 일치, 아니면 맨해튼 거리 이내
  const match = (c) => {
    if (tol === 0) return c === target;
    if (c === target) return true;
    if (!c || !target) return c === target;   // 한쪽만 투명이면 정확 일치만
    const rc = hexToRgb(c);
    return Math.abs(rc[0]-tc[0])+Math.abs(rc[1]-tc[1])+Math.abs(rc[2]-tc[2]) <= tol;
  };
  const stack = [[sx, sy]];
  const seen = new Uint8Array(state.res*state.res);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= state.res || y >= state.res) continue;
    const i = y * state.res + x;
    if (seen[i]) continue;
    if (!match(f[i])) continue;
    seen[i] = 1;
    f[i] = replace;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

// ---------- 도형 도구 ----------
// 도형이 차지하는 셀 좌표 목록을 반환 ([{x,y}...])
function shapeCells(tool, a, b, shiftKey) {
  let { x: x0, y: y0 } = a, { x: x1, y: y1 } = b;
  const cells = [];
  if (tool === 'line') {
    if (shiftKey) { // 45도 스냅
      const dx = x1 - x0, dy = y1 - y0;
      if (Math.abs(dx) > Math.abs(dy) * 2) y1 = y0;
      else if (Math.abs(dy) > Math.abs(dx) * 2) x1 = x0;
      else { const d = Math.min(Math.abs(dx), Math.abs(dy)); x1 = x0 + Math.sign(dx)*d; y1 = y0 + Math.sign(dy)*d; }
    }
    // Bresenham
    let X0=x0,Y0=y0; const adx=Math.abs(x1-x0),ady=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;
    let err=adx-ady;
    while(true){ cells.push({x:X0,y:Y0}); if(X0===x1&&Y0===y1)break; const e2=2*err; if(e2>-ady){err-=ady;X0+=sx;} if(e2<adx){err+=adx;Y0+=sy;} }
    return cells;
  }
  // 사각형/원: shift면 정사각형/정원
  let minx=Math.min(x0,x1),miny=Math.min(y0,y1),maxx=Math.max(x0,x1),maxy=Math.max(y0,y1);
  if (shiftKey) { const side=Math.min(maxx-minx,maxy-miny); maxx=minx+side; maxy=miny+side; }
  if (tool === 'rect') {
    for (let x=minx;x<=maxx;x++){ cells.push({x,y:miny}); cells.push({x,y:maxy}); }
    for (let y=miny;y<=maxy;y++){ cells.push({x:minx,y}); cells.push({x:maxx,y}); }
    if (state.rectFill) for (let y=miny+1;y<maxy;y++) for (let x=minx+1;x<maxx;x++) cells.push({x,y});
    return cells;
  }
  if (tool === 'ellipse') {
    // 중점 타원 알고리즘
    const rx=(maxx-minx)/2, ry=(maxy-miny)/2, cx=(minx+maxx)/2, cy=(miny+maxy)/2;
    if (rx<0.5||ry<0.5) { cells.push({x:Math.round(cx),y:Math.round(cy)}); return cells; }
    const seen=new Set();
    for (let t=0;t<360;t++){ const rad=t*Math.PI/180;
      const px=Math.round(cx+rx*Math.cos(rad)), py=Math.round(cy+ry*Math.sin(rad));
      const key=px+','+py; if(!seen.has(key)){seen.add(key);cells.push({x:px,y:py});}
    }
    return cells;
  }
  return cells;
}
// 도형 미리보기: 현재 화면(render) 위에 반투명으로 도형을 덧그림
function drawShapePreview() {
  if (!state.shapeStart || !state.shapeCur) return;
  const cells = shapeCells(state.tool, state.shapeStart, state.shapeCur, state.shiftKeyNow);
  const erasing = state.eraseMode;
  mainCtx.globalAlpha = erasing ? 0.4 : 0.7;
  mainCtx.fillStyle = erasing ? '#ff5555' : state.color;
  for (const c of cells) {
    if (c.x<0||c.y<0||c.x>=state.res||c.y>=state.res) continue;
    mainCtx.fillRect(c.x, c.y, 1, 1);
    // 대칭 미리보기
    if (state.mirrorX) mainCtx.fillRect(state.res-1-c.x, c.y, 1, 1);
    if (state.mirrorY) mainCtx.fillRect(c.x, state.res-1-c.y, 1, 1);
    if (state.mirrorX&&state.mirrorY) mainCtx.fillRect(state.res-1-c.x, state.res-1-c.y, 1, 1);
  }
  mainCtx.globalAlpha = 1;
}
// 도형 확정: 활성 레이어에 실제로 커밋
function commitShape() {
  if (!state.shapeStart || !state.shapeCur) return;
  const cells = shapeCells(state.tool, state.shapeStart, state.shapeCur, state.shiftKeyNow);
  const f = curPixels();
  const val = paintValue();
  for (const c of cells) setPixelMirrored(f, c.x, c.y, val);
  state.shapeStart = state.shapeCur = null;
  render(); renderLayerList();
}

// ---------- 선택 영역 (사각형) ----------
// 선택 테두리를 그리드 캔버스에 점선으로 표시
function drawSelectionOverlay() {
  if (!state.selection && !state.selFloat) return;
  const cellPx = state.display / state.res;
  let x0,y0,x1,y1;
  if (state.selFloat) { const F=state.selFloat; x0=F.ox; y0=F.oy; x1=F.ox+F.w; y1=F.oy+F.h; }
  else { const s=state.selection; x0=s.x0; y0=s.y0; x1=s.x1+1; y1=s.y1+1; }
  gridCtx.save();
  gridCtx.setLineDash([4,3]);
  gridCtx.lineWidth = 1.5;
  gridCtx.strokeStyle = 'rgba(120,180,255,0.95)';
  gridCtx.strokeRect(x0*cellPx+0.5, y0*cellPx+0.5, (x1-x0)*cellPx, (y1-y0)*cellPx);
  gridCtx.restore();
}
// 선택 영역의 픽셀을 떠있는 상태(selFloat)로 들어올림 (원본은 비움 = 잘라내기 방식 이동)
function liftSelection() {
  const s = state.selection; if (!s) return;
  const f = curPixels(), res = state.res;
  const w = s.x1-s.x0+1, h = s.y1-s.y0+1;
  const pix = new Array(w*h).fill(null);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const i=(s.y0+y)*res+(s.x0+x); pix[y*w+x]=f[i]; f[i]=null;
  }
  state.selFloat = { pixels: pix, ox: s.x0, oy: s.y0, w, h };
}
// 떠있는 픽셀을 현재 위치에 도장 찍기(레이어에 병합)
function stampFloat() {
  const F = state.selFloat; if (!F) return;
  const f = curPixels(), res = state.res;
  for (let y=0;y<F.h;y++) for (let x=0;x<F.w;x++){
    const c=F.pixels[y*F.w+x]; if(!c)continue;
    const px=F.ox+x, py=F.oy+y;
    if(px>=0&&py>=0&&px<res&&py<res) f[py*res+px]=c;
  }
}
// 선택 확정/해제
function clearSelection() {
  if (state.selFloat) { pushUndo(); stampFloat(); state.selFloat=null; }
  state.selection = null;
  render(); renderLayerList();
}
function deleteSelection() {
  pushUndo();
  if (state.selFloat) { state.selFloat=null; render(); return; }  // 떠있는 것 버리기
  const s=state.selection; if(!s)return;
  const f=curPixels(),res=state.res;
  for(let y=s.y0;y<=s.y1;y++)for(let x=s.x0;x<=s.x1;x++) f[y*res+x]=null;
  render(); renderLayerList();
}
function selectAll() {
  clearSelection();
  state.selection = { x0:0, y0:0, x1:state.res-1, y1:state.res-1 };
  render();
}
// 선택 영역이 특정 셀을 포함하는지
function selContains(cell) {
  if (state.selFloat) {
    const F=state.selFloat;
    if (cell.x<F.ox||cell.x>=F.ox+F.w||cell.y<F.oy||cell.y>=F.oy+F.h) return false;
    // 마스크(pixels null)면 실제 픽셀이 있는 곳만 포함으로 취급
    const lx=cell.x-F.ox, ly=cell.y-F.oy;
    return F.pixels[ly*F.w+lx] != null;
  }
  const s=state.selection; if(!s)return false;
  return cell.x>=s.x0&&cell.x<=s.x1&&cell.y>=s.y0&&cell.y<=s.y1;
}

// 부분 도트화: 선택 영역(도트 좌표)의 밑그림을 도트화해 새 레이어에 만든다.
// 밑그림 원본은 건드리지 않음. sampleRefColor와 동일한 픽셀 추출을 영역 전체에 적용.
function potraceRegion(sel) {
  const RB = window.DF && DF.RefBoard;
  const hasBoard = RB && RB.hasImages && RB.hasImages();
  const hasRefImg = state.refVisible && $('refImage').dataset.src;
  if (!hasBoard && !hasRefImg) {
    toast('먼저 참고 이미지를 올려주세요 (참고판 또는 밑그림).'); return;
  }
  const res = state.res;
  const x0 = Math.max(0, sel.x0), y0 = Math.max(0, sel.y0);
  const x1 = Math.min(res-1, sel.x1), y1 = Math.min(res-1, sel.y1);
  // 새 레이어 생성
  pushUndo();
  const fr = curFrame();
  const layer = makeLayer('도트화 ' + (fr.layers.length + 1));
  fr.layers.push(layer);
  fr.active = fr.layers.length - 1;
  const px = layer.pixels;
  let filled = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // 참고판(무드보드) 이미지 우선, 없으면 기존 밑그림
    let col = hasBoard ? RB.sampleCellColor(x, y) : null;
    if (!col && hasRefImg) col = sampleRefColor(x, y);
    if (col) { px[y*res + x] = col; filled++; }
  }
  render(); renderLayerList();
  if (filled) toast(`영역을 도트화해 새 레이어에 만들었어요 (${filled}칸).`);
  else toast('그 영역에서 참고 이미지 색을 찾지 못했어요. (이미지가 캔버스 위에 겹쳐 있어야 해요)');
}
function magicWandSelect(cell) {
  const f = curPixels(), res = state.res;
  const target = f[cell.i];
  if (!target) { toast('빈 곳입니다. 색이 있는 픽셀을 클릭하세요.'); return; }
  const tc = hexToRgb(target); if (!tc) return;   // [r,g,b]
  const tol = state.wandTol;   // 색 유사도 허용치 (설정에서 조절)
  // 비슷한 색 픽셀 수집 + bbox
  let x0=res, y0=res, x1=-1, y1=-1;
  const hits = [];
  for (let y=0;y<res;y++) for (let x=0;x<res;x++){
    const c = f[y*res+x]; if(!c) continue;
    const rc = hexToRgb(c); if(!rc) continue;   // [r,g,b]
    if (Math.abs(rc[0]-tc[0])+Math.abs(rc[1]-tc[1])+Math.abs(rc[2]-tc[2]) <= tol) {
      hits.push({x,y,c});
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
  }
  if (!hits.length) return;
  // 기존 선택 정리
  if (state.selFloat) { stampFloat(); state.selFloat=null; }
  pushUndo();

  // 모드 1: 새 레이어로 분리 — 선택 픽셀을 현재 레이어에서 들어내 새 레이어로
  if (state.wandToLayer) {
    const fr = curFrame();
    const newLayer = makeLayer('분리 ' + (fr.layers.length + 1));
    const np = newLayer.pixels;
    for (const p of hits) {
      np[p.y*res + p.x] = p.c;   // 새 레이어에 옮기고
      f[p.y*res + p.x] = null;   // 원본에서 제거
    }
    // 현재 레이어 바로 위에 삽입
    fr.layers.splice(fr.active + 1, 0, newLayer);
    fr.active = fr.active + 1;
    state.selection = null; state.selFloat = null;
    render(); renderLayerList();
    toast(`${hits.length}개 픽셀을 새 레이어로 분리했어요.`);
    return;
  }

  // 모드 2: 떠있는 선택(float)으로 — 이동/복사/삭제
  const w = x1-x0+1, h = y1-y0+1;
  const pix = new Array(w*h).fill(null);
  for (const p of hits) {
    pix[(p.y-y0)*w + (p.x-x0)] = p.c;   // float에 담고
    f[p.y*res + p.x] = null;            // 원본에서 들어냄 (선택=떠오름)
  }
  state.selection = null;
  state.selFloat = { pixels: pix, ox: x0, oy: y0, w, h };
  render(); renderLayerList();
  toast(`${hits.length}개 픽셀 선택 (이동·복사·삭제 가능)`);
}
// 클립보드에 선택 영역 픽셀 복사
function copySelection() {
  if (state.selFloat) {
    state.clipboard = { pixels: state.selFloat.pixels.slice(), w: state.selFloat.w, h: state.selFloat.h };
    toast('복사됨'); return;
  }
  const s = state.selection; if (!s) { toast('선택 영역이 없습니다.'); return; }
  const f = curPixels(), res = state.res, w=s.x1-s.x0+1, h=s.y1-s.y0+1;
  const pix = new Array(w*h).fill(null);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) pix[y*w+x]=f[(s.y0+y)*res+(s.x0+x)];
  state.clipboard = { pixels: pix, w, h };
  toast('복사됨');
}
// 클립보드를 떠있는 선택으로 붙여넣기 (좌상단 근처에)
function pasteClipboard() {
  const cb = state.clipboard; if (!cb) { toast('붙여넣을 내용이 없습니다.'); return; }
  pushUndo();
  if (state.selFloat) { stampFloat(); }
  selectTool('select');
  state.selFloat = { pixels: cb.pixels.slice(), ox: 0, oy: 0, w: cb.w, h: cb.h };
  state.selection = null;
  render(); toast('붙여넣기 — 드래그로 위치 이동');
}

// ---------- 노출 ----------
const exported = {
  paintValue, applyTool, sampleRefColor, setPixelMirrored, paintCell,
  shadeCell, adjustBrightness, hueShiftShade, rimLightApply, paintLine, bucketFill,
  shapeCells, drawShapePreview, commitShape,
  drawSelectionOverlay, liftSelection, stampFloat, clearSelection, deleteSelection,
  selectAll, selContains, potraceRegion, magicWandSelect, copySelection, pasteClipboard,
};
Object.assign(DF, exported);
// 전환기 병행 노출 (전체 분리 완료 시 제거)
Object.assign(window, exported);

})(window.DF);
