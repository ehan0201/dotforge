# Dotforge — AI 스프라이트 생성 설정

프롬프트로 이미지를 생성해 도트 변환 파이프라인으로 바로 넘기는 기능.
**Gemini 이미지 생성 + Node 프록시** 구조 (API 키는 서버에만, 브라우저 노출 없음).

## 구성
- `index.html` — 에디터. 헤더 **✨ AI 생성** 버튼 → 프롬프트 모달
- `server.js` — Gemini 호출 프록시 (키 숨김 + CORS 처리)

## 실행

### 1) 프록시 띄우기
```bash
# 단일 키
GEMINI_API_KEY=AIza... node server.js

# 여러 키 로테이션 (429/403 시 자동 다음 키)
GEMINI_API_KEYS=key1,key2,key3 node server.js

# 포트/모델 지정
PORT=8787 GEMINI_IMAGE_MODEL=gemini-2.5-flash-image node server.js
```
- 키 발급: Google AI Studio
- 기본 포트: `8787`
- 헬스체크: `GET http://localhost:8787/api/health`

### 2) 에디터에서
1. **✨ AI 생성** 클릭
2. 프롬프트 입력 (프리셋 칩으로 스타일 덧붙이기 가능)
3. **프록시 주소**가 server.js 주소와 같은지 확인 (기본 `http://localhost:8787`, 저장됨)
4. **생성** (Ctrl/Cmd+Enter) → 이미지 생성 후 도트 변환 화면 자동 진입
5. "도트풍 캐릭터 자동" 등으로 변환 → 프레임 삽입

## API 키 형식 (AIza / AQ.)
`AIza`, `AQ.` **두 형식 모두 지원**한다. Google이 새 키를 `AQ.` (Auth key)로 발급하기 시작했는데,
프록시는 키 형식을 검증하지 않고 그대로 전달하므로 어느 쪽이든 동작한다.

- 여러 형식 섞어 써도 됨: `GEMINI_API_KEYS=AQ.Ab...,AIza...`
- 프록시는 네이티브 엔드포인트(generativelanguage.googleapis.com)에 직접 호출 →
  이 경로는 `AQ.` 키도 문제없이 통과
- 만약 특정 환경에서 헤더 인증(`x-goog-api-key`)이 401을 내면,
  자동으로 쿼리 파라미터(`?key=`) 방식으로 한 번 더 시도한다
- 헬스체크(`/api/health`)의 `keyKinds`로 로드된 키 형식별 개수 확인 가능

> 참고: OpenAI 호환 엔드포인트(`/v1beta/openai`)에 `AQ.` 키를 Bearer로 보내면
> "Multiple authentication credentials received" 오류가 나지만, 이 프록시는 그 경로를 쓰지 않는다.

## 배포 시 네트워크
프록시를 호스팅하는 서버에서 `generativelanguage.googleapis.com` 아웃바운드(egress)가
방화벽/허용목록에 열려 있어야 한다. 막혀 있으면 "Host not in allowlist" 류의 오류가 난다.

## 모델
- 최신 대안: `gemini-3.1-flash-image` (Google가 Imagen 4 대체로 권장)
- 바꾸려면 `GEMINI_IMAGE_MODEL` 환경변수 또는 `server.js`의 `MODEL` 상수 수정
- 엔드포인트: `POST /v1beta/models/{MODEL}:generateContent`, 응답 이미지는 `candidates[0].content.parts[].inlineData.data` (base64)

## 프롬프트 보강
기본적으로 프록시가 "pixel art, single subject, solid background, no text..." 등을
자동으로 붙여 도트 변환이 잘 되게 유도한다.
모달의 **"프롬프트 보강 끄기"** 체크 시 입력을 그대로 전송 (raw 모드).

## 배포 시 주의
- `server.js`의 CORS `Access-Control-Allow-Origin: *` → 배포 도메인으로 제한 권장
- 프록시는 반드시 별도 서버(예: Node 호스팅, Cloudflare Workers 등)에 두고
  브라우저에서 그 주소를 프록시 주소로 입력
- 프록시 요청 본문은 5KB로 제한 (프롬프트 폭탄 방지)
- 타임아웃 60초
