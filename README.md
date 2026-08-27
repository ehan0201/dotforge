# Dotforge

단일 HTML 파일로 동작하는 픽셀 아트 애니메이션 에디터. HTML5 Canvas + 바닐라 JS, 빌드 과정 없음.

## 빠른 시작

```bash
# 1) 그냥 열기 — index.html을 브라우저로 직접 열어도 대부분 동작
open index.html            # macOS
# 또는 로컬 서버로 (권장, 일부 기능 안정)
npm run serve              # http://localhost:8080
```

AI 스프라이트 생성까지 쓰려면 프록시도 함께:

```bash
GEMINI_API_KEY=AIza... npm run dev   # 정적 서버 + AI 프록시 동시 실행
```

## 주요 기능

- **애니메이션**: 프레임(왼쪽 패널) × 레이어, 어니언 스킨, FPS/프레임별 시간, 재생 모드(루프/핑퐁/1회), 태그
- **도구**: 펜·지우개·페인트 통(유사도)·스포이드·마법봉(비슷한 색 전체 선택, 레이어 분리)·명암(원형 셰이딩, 세기·방향 조절)·직선·사각형·원·선택·부분 도트화
- **도구 세부 설정**: 도구에 마우스 올리면 스탯 툴팁, 선택된 도구 재클릭하면 세부 설정 팝오버
- **밑그림(레퍼런스)**: 이미지/스프라이트 시트를 깔고 따라 그리기. 시트는 프레임마다 칸 표시. 확대/이동, Shift로 진하게+스포이드. 프로젝트에 함께 저장.
- **색상**: HSV 색상판, 팔레트 세트, 즐겨찾기(C+숫자), 최근 색(V+숫자)
- **저장/내보내기**: 프로젝트 .json 저장·열기, 브라우저 보관함(IndexedDB), PNG/시트/GIF 내보내기(배수 선택)
- **입력**: 핫바(마인크래프트식), 인벤토리(TAB), 단축키 커스터마이즈

## 개발

```bash
npm run validate     # 배포 전 검증 (JS 문법 + HTML 태그 균형) — 반드시 실행
npm run serve        # 로컬 미리보기
npm run proxy        # AI 프록시만
```

코드를 수정하면 **반드시 `npm run validate`를 통과**시킨 뒤 배포한다. 자세한 아키텍처와 규칙은 [`CLAUDE.md`](./CLAUDE.md) 참고.

## 구조

```
index.html          에디터 전체 (HTML+CSS+JS 인라인, 단일 파일)
server.js           AI 스프라이트 생성 프록시 (Gemini, 선택적)
scripts/serve.js    의존성 없는 정적 서버
scripts/validate.js 배포 전 검증
docs/AI_SETUP.md    AI 생성 기능 설정
CLAUDE.md           개발 지침 (Claude Code가 읽는 파일)
```

## AI 스프라이트 생성

프롬프트로 이미지를 만들어 도트 변환으로 넘기는 기능. Gemini 프록시 필요.
설정은 [`docs/AI_SETUP.md`](./docs/AI_SETUP.md) 참고.
