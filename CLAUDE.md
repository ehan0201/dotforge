# CLAUDE.md — Dotforge 개발 지침

이 파일은 Claude Code가 매 세션 자동으로 읽는 프로젝트 지침이다. Dotforge를 이어서 개발할 때 아래 규칙과 구조를 반드시 지킨다.

## 프로젝트 개요

**Dotforge** — 단일 HTML 파일로 동작하는 픽셀 아트 애니메이션 에디터.
- 스택: HTML5 Canvas + Tailwind(CDN) + 바닐라 JS. 빌드 과정 없음. `index.html` 하나가 전체 앱.
- 테마: Zinc 다크. 한국어 UI.
- 보조: `server.js` (AI 스프라이트 생성용 Gemini 프록시, 선택적).

## 진행 중: 모듈 분리 리팩터링

단일 파일 제약은 아티팩트 미리보기 때문이었고, CLI에선 불필요하다. **`REFACTOR.md`의 계획대로 `index.html`의 인라인 JS를 `src/*.js`로 점진 분리 중.**
- 이미 완료: CSS를 `src/styles.css`로 분리 (index.html은 `<link>`로 로드).
- 다음: JS를 `window.DF` 네임스페이스 방식으로 파일별 분리. **한 번에 다 하지 말 것** — REFACTOR.md의 순서(state→color→render→…)대로 하나씩, 옮길 때마다 `npm run validate` + 브라우저 확인 + 커밋.
- 분리 방식/함수 매핑/주의사항은 전부 `REFACTOR.md` 참고.

아직 JS는 index.html에 인라인 상태다. 분리 작업을 이어서 하거나, 기능 개발을 먼저 해도 된다 (분리는 독립적으로 진행 가능).

## 절대 규칙 (변경 금지)

### 1. 배포 전 검증은 필수다
코드를 수정하면 **반드시** 아래 순서로 검증한 뒤에만 완료로 간주한다:

```bash
npm run validate      # 문법 + HTML 태그 균형 자동 검사
```

또는 수동으로:
1. **JS 문법 검증** — `<script>` 본문을 `new Function()`으로 파싱해 SyntaxError 확인
2. **로직 단위 테스트** — 순수 함수는 jsdom으로 격리 테스트 (실제 함수를 추출해 검증하되, 의존 함수 stub은 **실제 시그니처와 동일하게** 만들 것 — 예: `hexToRgb`는 `{r,g,b}` 객체가 아니라 `[r,g,b]` 배열을 반환한다. stub을 틀리게 만들면 버그를 못 잡는다)
3. **HTML 태그 균형** — `<div>`/`</div>`, `<aside>`, `<main>` 개수 일치 확인

검증 없이 배포하지 않는다. 이 규칙은 이 프로젝트에서 수많은 버그를 잡아냈다.

### 2. CSP / 샌드박스 제약
- `blob:` URL 금지 → data URL 사용
- `alert()` 금지 → `toast()` 사용
- `localStorage`는 반드시 try/catch로 감싸기 (차단 환경 폴백). 용량 초과 대비 필요 (밑그림 이미지 등 큰 데이터).
- 브라우저 저장은 IndexedDB(프로젝트 보관함) + localStorage(자동저장/설정) 병행.

### 3. 모듈 구조 (CLI 버전)
CSS는 `src/styles.css`로 분리됨. JS는 `REFACTOR.md`에 따라 `src/*.js`로 분리 진행 중 (window.DF 네임스페이스, 빌드 없음). Tailwind만 CDN. 분리 전까지는 index.html 인라인 JS를 수정하되, 새 기능은 가능하면 해당 모듈이 생긴 뒤 그쪽에 추가.

## 아키텍처

### 전역 상태 (`state` 객체, index.html 내 `// ---------- 전역 상태`)
- `frames[]` — 각 프레임 = `{ layers[], active, duration }`
- `layers[]` — 각 레이어 = `{ pixels: Array(res*res), opacity, visible, name, blend }`
- `pixels` — 1차원 배열, 각 칸은 hex 문자열(`'#rrggbb'`) 또는 `null`(투명). 인덱스 = `y*res + x`
- `res` — 캔버스 해상도(정사각). `current` — 현재 프레임 인덱스.
- `ref` — 밑그림(레퍼런스): `{ scale, offsetX, offsetY, opacity, sheet:{cols,rows}|null, natW, natH, adjust }`

### 핵심 헬퍼
- `curFrame()`, `curLayer()`, `curPixels()` — 현재 컨텍스트 접근
- `flattenFrame(fr)` — 레이어 합성 → 단일 픽셀 배열
- `frameToCanvas(frame, scale)` — 프레임을 canvas로 렌더 (내보내기용)
- `pushUndo()` — 조작 전 스냅샷 저장 (undo/redo)
- `render()` — 메인 캔버스 다시 그림. 시트 밑그림이면 `applyRefTransform()`도 호출.
- `hexToRgb(hex)` → `[r,g,b]` **배열** / `rgbToHex(r,g,b)` → `'#rrggbb'`

### 캔버스 레이어 z-index
`bgCanvas(0)` < `refImage(1)` < 어니언(5,6,10) < `mainCanvas(20)` < `gridCanvas(30)`.
Shift 홀드 시 밑그림 → z26(어니언 위) + 불투명. `applyRefTransform()`이 `state.shiftHeld`를 보고 처리.

### 밑그림(레퍼런스) — 중요
- `refImage`는 `<div>` + `background-image` 방식 (CSS 스프라이트). data는 `dataset.src`에 보관.
- 위치/크기는 **% 기준**으로 계산 (px 아님) → 캔버스 줌/리사이즈에 자동으로 따라옴. `getBoundingClientRect`의 px에 의존하지 말 것.
- 시트 모드: 칸을 비율 유지(contain)로 배치. 프레임 넘기면 `background-position`이 이동해 해당 칸 표시.
- 프로젝트 저장 시 `serializeProject()`에 `ref` 포함 (이미지 data + 설정). autoSave는 용량 초과 시 이미지만 제외.

### 도구 시스템
- `TOOLS[]` 배열 + `invItems()` (인벤토리) + `ICON_PATHS` (SVG) + 툴바 버튼(`data-tool`).
- `applyTool(cell)`의 switch로 도구별 동작 분기.
- 도구별 세부 설정: `TOOL_SETTINGS` — `stats()`(툴팁 스탯) + `controls`(재클릭 팝오버 편집). 새 도구 추가 시 여기도 등록.
- 현재 도구: pen, eraser, bucket(유사도), picker, wand(마법봉·레이어분리), shade(명암), line, rect, ellipse, select, potrace(부분 도트화).

### 선택 시스템
- `state.selection` — 사각형 `{x0,y0,x1,y1}`
- `state.selFloat` — 떠있는 선택 `{pixels, ox, oy, w, h}` (마스크 기반, null=미선택). 이동/복사/삭제.
- `selContains(cell)` — 마스크 인식.

### 저장/직렬화
- `serializeProject()` / `loadProjectData(d)` — 프레임·레이어·팔레트·밑그림 왕복.
- 자동저장: localStorage `dotforge_autosave` (디바운스 800ms).
- 보관함: IndexedDB `dotforge_library` (프로젝트 여러 개, 썸네일 포함).
- 파일: `.json` 저장/열기 (💾/📂).
- 내보내기: PNG(현재 프레임) / 시트 PNG(열 수 지정) / GIF (`encodeGif`). 배수 선택.

## 파일 구조
```
dotforge/
├── CLAUDE.md          # 이 파일
├── README.md          # 사람용 실행/개발 안내
├── index.html         # 에디터 전체 (단일 파일)
├── server.js          # AI 프록시 (Gemini, 선택적)
├── package.json       # npm 스크립트
├── scripts/validate.js # 배포 전 검증 자동화
└── docs/AI_SETUP.md   # AI 생성 기능 설정
```

## 개발 워크플로

```bash
npm run serve       # 로컬 정적 서버로 index.html 미리보기 (기본 8080)
npm run dev         # AI 프록시(server.js) + 정적 서버 동시 실행
npm run validate    # 배포 전 검증 (문법 + 태그 균형)
```

작업 순서: 코드 수정 → `npm run validate` → (로직 바뀌면 jsdom 테스트 작성/실행) → 브라우저 확인.

## 자주 건드리는 지점 (grep 앵커)
- 전역 상태: `// ---------- 전역 상태`
- 도구 분기: `function applyTool`
- 도구 정의: `const TOOLS`, `function invItems`, `const ICON_PATHS`, `const TOOL_SETTINGS`
- 밑그림: `function applyRefTransform`, `function sampleRefColor`, `function loadRefImage`
- 저장: `function serializeProject`, `function loadProjectData`
- 내보내기: `// ---------- 내보내기 모달`
- 단축키: `const DEFAULT_BINDINGS`, `function comboFromEvent`

## 알려진 함정
- `hexToRgb`는 배열 반환. `.r/.g/.b`로 접근하면 `undefined` → `NaN` 버그. 반드시 `[0]/[1]/[2]`.
- macOS에서 `Cmd+문자`는 keyup이 안 와 키가 `keysDown`에 갇힘. 수식키와 눌린 문자는 `keysDown`에 넣지 않고, 홀드는 1.5초 만료 처리.
- 밑그림 위치는 % 기준. px 계산으로 바꾸면 줌 시 어긋남.
- 검증용 jsdom stub은 실제 함수 시그니처와 일치시킬 것 (안 그러면 통과해도 실제로는 버그).
