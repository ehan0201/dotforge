/* =====================================================================
   Dotforge — state.js
   전역 상태 + 데이터 모델(프레임/레이어/픽셀) + 실행취소/다시실행.
   REFACTOR.md 모듈 분리 1단계.

   노출 방식: window.DF 네임스페이스에 노출한다. 다만 아직 index.html
   인라인 코드 대부분이 이 심볼들을 bare 전역(`state`, `curFrame()` …)으로
   참조하므로, 전환기 동안 window 전역에도 병행 노출한다.
   (나머지 모듈이 전부 분리되면 window 병행 노출 블록은 제거한다.)

   이 스크립트는 index.html 인라인 <script>보다 먼저 로드되어야 한다
   (인라인 최상위 코드가 state를 즉시 사용).
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

// ---------- 전역 상태 ----------
const state = {
  res: 32, display: 512,
  frames: [], current: 0,
  tool: 'pen', prevTool: 'pen',
  color: '#ffffff',
  hue: 0, sv: { s: 0, v: 1 },      // 색상판 상태 (Hue, 채도/명도)
  favorites: [],                   // 즐겨찾기 색상 (localStorage 저장)
  showGrid: true, showOnion: true,
  onionCount: 3,             // 표시할 이전 프레임 개수 (1~3)
  onionOpacity: 0.3,         // 직전 프레임 기준 투명도 (이후 단계는 비율로 감소)
  shiftHeld: false,          // Shift 누름 상태 (어니언을 위로 + 스포이드로 이전색 추출)
  fps: 8, playing: false,
  palette: [], drawing: false,
  lastCell: null,                 // 라인 보간용 직전 칸
  bucketErase: false,             // (구) 페인트 통 지우기 — eraseMode로 통합
  eraseMode: false,               // 지우기 모드: 모든 그리기 도구가 투명(null)을 칠함
  brushSize: 1,                   // 펜/지우개 브러시 크기 (한 변의 칸 수)
  wandTol: 48,                    // 마법봉 색 유사도 허용치 (0~255)
  bucketTol: 0,                   // 페인트 통 색 유사도 (0=완전 같은 색만)
  wandGlobal: true,               // 마법봉: true=전체 유사색, false=연결된 영역만
  wandToLayer: false,             // 마법봉: true면 선택을 새 레이어로 분리
  shadeStrength: 12,              // 셰이딩 세기 (%, 한 번 지날 때 명도 감소량)
  shadeMode: 'outer',             // outer=바깥일수록 어두움, inner=중심일수록 어두움
  shadeLighten: false,            // true면 어둡게가 아니라 밝게(하이라이트)
  shadeHue: true,                 // 휴 시프트 명암(하이비트식): 그림자=차갑게/하이라이트=따뜻하게
  shadeHueAmount: 28,             // 색조 이동 최대 각도(도)
  potraceMode: 'newlayer',        // 부분 도트화 결과: 새 레이어
  defaultDuration: 100,           // 새 프레임 기본 지속시간(ms)
  useDuration: false,             // true면 프레임별 duration으로 재생, false면 균일 FPS
  playMode: 'loop',               // loop | pingpong | once
  playReverse: false,             // 역방향 재생
  playDir: 1,                     // 내부: 핑퐁 방향
  tags: [],                       // [{name, from, to, color}]
  activeTag: null,                // 재생 범위 태그 인덱스 (null=전체)
  mirrorX: false, mirrorY: false, // 대칭 그리기
  shapeStart: null, shapeCur: null, rectFill: false, // 도형 드래그 상태
  shiftKeyNow: false,             // 도형 그릴 때 Shift 눌림 여부
  autoReturnPen: true,            // 스포이드 클릭 후 이전 도구 자동 복귀
  // 선택 영역(사각형)
  selection: null,                // {x0,y0,x1,y1} 정규화된 셀 범위 (없으면 null)
  selFloat: null,                 // 떠 있는(이동 중) 픽셀 {pixels,ox,oy,w,h}
  selDragging: false, selMoving: false, selStart: null, selMoveStart: null,
  selSpaceMoving: false,          // Space+드래그로 선택 이동 중
  clipboard: null,                // 복사된 픽셀 {pixels,w,h}
  oneShotReturn: null,            // 인벤토리에서 1회용으로 고른 도구 사용 후 복귀할 도구
  invHoverTool: null,             // 인벤토리에서 마우스 올린 도구 (숫자키 지정용)
  favSlots: [],                   // Ctrl+숫자로 지정하는 팔레트 슬롯
  spaceHeld: false,               // 스페이스바 누름 (패닝 모드)
  panning: false, panStartX: 0, panStartY: 0, scrollStartX: 0, scrollStartY: 0,
  panX: 0, panY: 0,               // 캔버스 화면 이동 오프셋(px)
  refVisible: false,              // 레퍼런스 밑그림 표시 여부
  // 참고판(무드보드): 작업공간에 자유 배치하는 참고 이미지 여러 장. 밑그림(ref)과 독립.
  // 각 항목 {id, src, natW, natH, fx, fy, fw, opacity} — fx/fy/fw는 canvasWrap 대비 비율(0~1)
  refBoards: [],
  refBoardEdit: false,            // 참고판 편집 모드(드래그/리사이즈). off면 그 위로 그대로 그림
  _refBoardSeq: 0,                // 참고판 id 시퀀스
  // 밑그림(레퍼런스) 확장 상태
  ref: {
    scale: 1, offsetX: 0, offsetY: 0,   // 확대/이동 (transform)
    opacity: 0.5,
    sheet: null,                        // 시트 모드: {cols, rows} 또는 null
    adjust: false,                      // 밑그림 조작 모드(드래그=이동, 휠=확대)
    natW: 0, natH: 0,                   // 원본 이미지 크기
  },
  gridView: false,                // 타임라인 프레임×레이어 격자 보기
  spaceMoved: false,              // 스페이스 누른 동안 드래그가 있었는지(재생 오발동 방지)
  undoStack: [], redoStack: [],   // 실행취소/다시실행 히스토리 (프레임 전체 스냅샷)
  zoom: 1,                        // 캔버스 확대 배율
  baseDisplay: 512,               // 줌 1.0 기준 캔버스 픽셀 크기
  started: false,            // 로비를 벗어나 에디터가 활성화됐는지
  hiBit: false,              // 하이비트 전용 프로젝트로 시작했는지(고해상도·고색상 정밀 작업)
  // 글로우/조명(산나비풍 네온 발광 블룸). 밝은 픽셀이 번져 빛나며, 내보내기에도 구워짐.
  // source: 'emissive'(발광 지정 레이어만·정석) | 'bright'(밝기 임계값) | 'both'
  glow: { enabled: false, source: 'emissive', threshold: 0.6, intensity: 0.9, radius: 2.2, tint: null },
};

// ---------- 데이터 모델: 프레임 = 여러 레이어 + 지속시간 ----------
function makeEmptyPixels() { return new Array(state.res * state.res).fill(null); }
function makeLayer(name) {
  return { pixels: makeEmptyPixels(), opacity: 1, visible: true, name: name || '레이어 1', blend: 'source-over', emissive: false };
}
function makeEmptyFrame() {
  return { layers: [makeLayer('레이어 1')], active: 0, duration: state.defaultDuration };
}
// 현재 프레임 / 활성 레이어 / 그릴 픽셀 배열 접근자
function curFrame() { return state.frames[state.current]; }
function curLayer() { const fr = curFrame(); return fr.layers[fr.active]; }
function curPixels() { return curLayer().pixels; }

// 프레임의 모든 보이는 레이어를 아래→위로 합성해 픽셀 배열 반환 (썸네일/변환/내보내기용, opacity 무시한 최종색은 상위 우선)
function flattenFrame(fr) {
  const out = makeEmptyPixels();
  for (let li = 0; li < fr.layers.length; li++) {
    const L = fr.layers[li];
    if (!L.visible) continue;
    const p = L.pixels;
    for (let i = 0; i < p.length; i++) if (p[i]) out[i] = p[i];
  }
  return out;
}

// ---------- 실행취소 / 다시실행 ----------
// 프레임 전체를 깊은 복사로 스냅샷 (레이어/픽셀/설정 포함)
function cloneFrame(fr) {
  return {
    layers: fr.layers.map(L => ({ pixels: L.pixels.slice(), opacity: L.opacity, visible: L.visible, name: L.name, blend: L.blend || 'source-over', emissive: !!L.emissive })),
    active: fr.active, duration: fr.duration
  };
}
function snapshot() {
  return { frames: state.frames.map(cloneFrame), current: state.current };
}
function pushUndo() {
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 60) state.undoStack.shift();  // 메모리 상한(레이어 포함이라 축소)
  state.redoStack.length = 0;
  autoSave();
}
function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshot());
  const s = state.undoStack.pop();
  state.frames = s.frames; state.current = Math.min(s.current, s.frames.length - 1);
  render(); renderLayerList(); autoSave();
}
function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshot());
  const s = state.redoStack.pop();
  state.frames = s.frames; state.current = Math.min(s.current, s.frames.length - 1);
  render(); renderLayerList();
}

// ---------- 노출 ----------
// undo/redo/pushUndo가 부르는 render·renderLayerList·autoSave는 아직 index.html
// 인라인에 있으며 런타임(클릭 시) window 전역으로 해소된다.
const exported = {
  state,
  makeEmptyPixels, makeLayer, makeEmptyFrame, curFrame, curLayer, curPixels, flattenFrame,
  cloneFrame, snapshot, pushUndo, undo, redo,
};
Object.assign(DF, exported);
// 전환기 병행 노출 (전체 분리 완료 시 제거)
Object.assign(window, exported);

})(window.DF);
