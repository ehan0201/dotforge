# 모듈 분리 가이드 (REFACTOR.md)

`index.html`의 인라인 JS(~4800줄)를 `src/*.js`로 나누는 계획. **Claude Code에서 이 문서를 따라 점진적으로 진행한다.** 한 번에 다 옮기지 말고 파일 하나씩, 옮길 때마다 `npm run validate`와 브라우저 확인.

## 방식: 전역 네임스페이스 (`window.DF`), 빌드 없음

완전한 ES 모듈(import/export)이 아니라, **전역 객체 `window.DF`에 함수/상태를 붙이는 방식**을 쓴다. 이유:
- 현재 코드가 4800줄 단일 스코프에서 함수들이 서로 자유롭게 호출 → import 관계를 전부 연결하면 실수 위험 큼
- `window.DF` 방식은 함수 본문 거의 그대로, 파일만 나뉨 → 안전하고 토큰 절약
- 빌드/번들러 불필요. `index.html`에서 `<script src>`로 순서대로 로드.

각 `src/*.js` 파일 맨 위:
```js
window.DF = window.DF || {};
(function(DF){
  'use strict';
  // ... 이 모듈의 함수들 ...
  // 다른 모듈에서 쓸 것만 노출:
  Object.assign(DF, { 함수1, 함수2, ... });
})(window.DF);
```
다른 모듈 함수를 부를 땐 `DF.함수()`. 상태는 `DF.state` 하나로 공유.

**로드 순서**(의존성 순, index.html 하단):
```html
<script src="src/state.js"></script>
<script src="src/color.js"></script>
<script src="src/render.js"></script>
<script src="src/tools.js"></script>
<script src="src/image.js"></script>
<script src="src/ref.js"></script>
<script src="src/layers.js"></script>
<script src="src/frames.js"></script>
<script src="src/io.js"></script>
<script src="src/ui.js"></script>
<script src="src/main.js"></script>
```

## 함수 → 파일 매핑

아래 줄 번호는 **JS 시작(원본 index.html 1007번째 줄)부터의 상대 줄번호**. 원본에서 `grep -n "// ----------"` 하면 절대 위치 확인 가능.

### src/state.js  — 전역 상태 + 데이터 모델 + undo
- `state` 객체 (상대 6~)
- 데이터 모델: makeEmptyPixels, makeLayer, makeEmptyFrame, curFrame, curLayer, curPixels, flattenFrame (81~)
- undo/redo: cloneFrame, snapshot, pushUndo, undo, redo (106~)

### src/color.js — 색상 유틸 + 팔레트 + 즐겨찾기
- hsvToRgb, rgbToHsv, hexToRgb, rgbToHex (718~) ⚠ hexToRgb는 **배열** 반환
- setColor, updatePickerUI, applyPickerColor, pushPalette, renderPalette (738~)
- 즐겨찾기: loadFavorites, saveFavorites, addFavorite, removeFavorite, setFavSlot, renderFavorites (787~)
- Palettes 모듈 (855~)

### src/render.js — 캔버스/렌더/줌
- initCanvasSize, applyZoom, setZoom (138~)
- render, renderOnion, drawGrid, getCell (169~)

### src/tools.js — 도구
- paintValue, applyTool, setPixelMirrored, paintCell (264~)
- 셰이딩: shadeCell, adjustBrightness (387~)
- paintLine, bucketFill (440~)
- 도형: shapeCells, drawShapePreview, commitShape (480~)
- 선택: drawSelectionOverlay, liftSelection, stampFloat, clearSelection, deleteSelection, selectAll, selContains, potraceRegion, magicWandSelect, copySelection, pasteClipboard (548~)
- sampleRefColor는 밑그림 의존이지만 도구(스포이드)에서 씀 → tools 또는 ref 중 택1 (원본 310~)

### src/image.js — 이미지 변환/크롭/시트분할
- 크롭 모달: renderCropResBtns, openCropModal, closeCropModal, centerCrop, clampCrop, drawCrop, drawCropGrid, drawCropPreview, computeCropDots, syncCropZoomSlider, setCropScale, confirmCrop (1043~)
- detectPixelScale, splitSpriteSheet, convertImageWithDot, convertImage, loadFile (1481~)

### src/ref.js — 밑그림(레퍼런스)
- setRefVisible, applyRefTransform, setRefAdjust, loadRefImage, ensureFramesForSheet, syncSheetUI (원본 // 레퍼런스 밑그림, 3842~)
- sampleRefColor (310~, tools와 공유)

### src/frames.js — 프레임/재생
- renderFrameList, renderFrameGrid, addFrame, duplicateFrame, deleteFrame (1871~)
- 재생: playRange, scheduleNextFrame, togglePlay (2027~)
- gotoFrame, moveFrame (4442~)
- 애니메이션 고급 패널: renderPlayMode, renderTags, setOnion (4098~)

### src/layers.js — 레이어
- addLayer, moveLayer, selectLayer, mergeLayerInto, reorderLayer, renderLayerList, setBrushSize 관련 등 (원본에서 renderLayerList/레이어 함수 위치 grep)

### src/io.js — 저장/보관함/내보내기
- frameToCanvas (2073~)
- 프로젝트 저장/열기: serializeProject, loadProjectData, saveProject, openProject (2096~)
- 자동저장: autoSave, restoreAutoSave (2220~)
- GIF: encodeGif 등 (2250~)
- 내보내기 모달 (4209~)
- 보관함 IndexedDB (4322~)

### src/ui.js — 패널/툴팁/팝오버/단축키/핫바/인벤토리
- 핫바/인벤토리: loadHotbar, saveHotbar, selectHotbar, assignHotbar, renderHotbar, openInventory 등
- 도구 설정 시스템: TOOL_SETTINGS, showToolTooltip, openToolPopover (3042~)
- 커스텀 툴팁: showTooltip, hideTooltip (3175~)
- 패널 리사이저 (3604~), 탭 전환 (3661~)
- 단축키: DEFAULT_BINDINGS, comboFromEvent, findAction, keydown/keyup 핸들러 (4460~)
- 튜토리얼/가이드북 (2848~)
- 도구 정의: TOOLS, invItems, ICON_PATHS, svgIcon, selectTool, TOOLBAR_TIPS
- AI 생성 모달 (3747~)

### src/main.js — 초기화/이벤트 바인딩/진입점
- selectTool 바인딩, pointerdown/move/up (handleDrawMove, endStroke, drawBrushHover)
- 스페이스 패닝 (4737~)
- 로비 표시/시작 (4786~)
- 전역 이벤트 리스너들

## 진행 상황

- ✅ `src/state.js` — 완료. 전역 상태 객체 + 데이터 모델(makeEmptyPixels/makeLayer/makeEmptyFrame/curFrame/curLayer/curPixels/flattenFrame) + undo/redo를 분리. `DF`와 `window`에 병행 노출(전환기). index.html 인라인 `<script>` **앞**에 로드. `$`/캔버스 참조 const는 아직 인라인.
- ✅ `src/color.js` — 완료. 색상 유틸(hsvToRgb/rgbToHsv/hexToRgb/rgbToHex) + setColor/updatePickerUI/applyPickerColor + 팔레트(pushPalette/renderPalette) + 즐겨찾기(load/save/add/remove/setFavSlot/renderFavorites) + `Palettes` 세트 모듈. state.js 다음, 인라인 앞에 로드. `$`는 인라인의 top-level const(전역 lexical 공유)로 런타임 해소.
- ⬜ 다음: `src/render.js` (initCanvasSize/applyZoom/setZoom/render/renderOnion/drawGrid/getCell). 단, render/getCell은 `$`·캔버스 const(bgCanvas/mainCtx 등, 아직 인라인)에 강하게 의존 → 캔버스 참조 const도 함께 옮길지 검토 필요.

## 진행 순서 (Claude Code)

1. `src/state.js`부터. 원본에서 해당 함수 잘라 붙이고, `DF`에 노출. 다른 모듈이 아직 없으니 이 단계는 로드만 확인.
2. 아래→위 의존 순으로 하나씩(color → render → tools …). 옮길 때마다:
   - 원본 index.html에서 그 함수들 **제거**
   - `src/파일.js`에 추가 + `DF`에 노출
   - 함수 내부에서 다른 모듈 함수 호출은 `DF.함수()`로 (또는 구조분해 `const {render}=DF`)
   - `index.html`에 `<script src>` 추가
   - `npm run validate` + 브라우저에서 해당 기능 클릭 테스트
3. 전부 옮기면 index.html의 `<script>` 인라인 블록은 비고, `<script src>`만 남는다.
4. CSS도 `<link rel="stylesheet" href="src/styles.css">`로 (이미 src/styles.css 추출됨).

## 주의
- `state`는 반드시 하나만. `DF.state`로 공유. 각 모듈이 자기 state 만들면 안 됨.
- 전역처럼 쓰던 `$`(getElementById 헬퍼), `toast` 등은 state.js나 util에 두고 `DF.$`로.
- 이벤트 리스너/DOM 접근은 DOM 로드 후 실행되게 (스크립트가 body 끝에 있으면 OK).
- 한 파일 옮길 때마다 커밋. 문제 생기면 직전 커밋으로 롤백.
- ⚠ hexToRgb 배열 반환, macOS Cmd+키 갇힘 등 CLAUDE.md의 "알려진 함정" 유지.
