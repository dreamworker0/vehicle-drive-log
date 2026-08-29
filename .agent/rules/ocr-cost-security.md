# 🛡️ Gemini OCR 비용 통제 및 이미지 업로드 보안 규칙

이 규칙은 AI API(Gemini OCR) 호출로 인한 비정상적인 비용 청구를 예방하고, 업로드된 민감 증빙 서류 이미지의 불법적인 접근을 차단하기 위한 필수 아키텍처 규칙입니다.

> 📌 구현 패턴은 [gemini-ocr-integration 스킬](../skills/gemini-ocr-integration/SKILL.md) 참고

---

## 1. OCR API 비용 통제 (Rate Limit)

Gemini API 호출은 종량제 비용이 발생하므로, 악의적이거나 비정상적인 반복 호출을 차단하기 위해 **반드시 서버사이드(Cloud Functions)에서 호출 제한 검증 로직을 수행**해야 합니다.

### 1.1 일일 호출 제한 강제 (구현됨 — 2026-07-03)
*   **규칙**: 사용자의 UID **및** 조직 ID(`organizationId`)를 기준으로, 하루 동안 허용되는 OCR 호출 최대 횟수를 제한합니다. 분 단위 제한(§1.3)과 별개의 방어선입니다.
    *   **기준값**: 사용자당 일일 최대 **20회**, 조직당 일일 최대 **50회** (`constants.ts`의 `ocrDailyUser`/`ocrDailyOrg`, Remote Config `rate_limits`로 조율 가능).
*   **구현** (`functions/src/utils/rateLimit.ts`의 `checkDailyOcrQuota`):
    *   기존 `_rateLimits` 컬렉션의 창 버킷 로직을 재사용합니다 — epoch 정렬 24시간 버킷, TTL(`expiresAt`) 자동 정리. 별도 카운터 문서를 만들지 않습니다.
    *   `ocrDashboard`·`ocrDocument` 핸들러 서두에서 호출하며, 두 함수가 **통합 카운터**를 공유합니다 (키: `ocrDailyUser:{uid}`, `ocrDailyOrg:{orgId}`).
    *   초과 시 `HttpsError("resource-exhausted", "일일 OCR 호출 한도를 초과했습니다. 내일 다시 시도해주세요.")`를 반환합니다.
    *   창 경계는 KST 자정이 아니라 epoch 기준 24시간 버킷입니다(단순성 우선 — 남용 방어 목적에 충분).

### 1.3 분 단위 제한 (기존)
*   `wrapCallableHandler`의 `rateLimitKey`로 uid별 분 단위 제한이 걸려 있습니다: `ocrDashboard` 분당 5회, `ocrDocument` 분당 3회, `askAI` 분당 5회.

### 1.2 프론트엔드 중복 클릭 방지 (Debounce/Throttle)
*   **규칙**: 프론트엔드에서 이미지 업로드 및 분석 버튼을 누른 후, 응답이 올 때까지 버튼을 비활성화(`disabled`)하고 스피너를 보여주어 중복 API 호출을 원천 차단해야 합니다.

### 1.4 전역 예산 — 주체를 특정할 수 없는 경로 (구현됨 — 2026-08-14)

주체별 상한(uid·이메일·IP)은 **주체를 회전시킬 수 있으면 상한이 아니다.** 비인증 경로에서 이메일은 미검증 문자열이고 IP는 헤더로 조작 가능하므로(§1.5), 회전으로 전부 무력화된다.

*   **규칙**: 비인증이거나 주체를 무한히 만들 수 있는 경로가 Gemini를 부르면, 주체와 무관한 **단일 카운터(전역 예산)를 fail-closed로** 하나 더 건다. 이 값이 그 경로의 시간당(또는 일일) 최대 청구액이다.
*   **기준값**: `functions/src/utils/constants.ts`의 `GLOBAL_BUDGETS`. 정상 사용량의 10배 이상으로 잡되 무한대는 아니게 한다.
*   **Remote Config로 조율하지 않는다** — 조율 경로가 장애나면 상한 자체가 사라지기 때문에 배포된 코드에 고정한다.
*   **구현**: `checkGlobalBudget(name, max, windowSec)` (`utils/rateLimit.ts`).

### 1.5 IP를 레이트리밋 키로 쓸 때 (필수 — 2026-08-14 감사 발견 2)

*   **규칙**: `req.ip`나 `headers['x-forwarded-for']`를 **그대로 쓰지 않는다.** 반드시 `resolveClientIp()`(`functions/src/utils/clientIp.ts`)를 거친다.
*   **이유**: Cloud Functions 2세대 런타임은 Express에 `trust proxy`를 켜 두어 `req.ip`가 X-Forwarded-For의 맨 앞 값이 된다. 구글 프런트엔드는 클라이언트가 보낸 XFF를 지우지 않고 뒤에 덧붙이므로, 맨 앞은 **호출자가 적어 넣은 문자열**이다. 그대로 키로 쓰면 헤더 한 줄로 매 요청 새 버킷이 생겨 상한이 사라진다.
*   **인증이 선행하는 엔드포인트는 IP가 아니라 uid로 키를 잡는다** — 위조도, 같은 프록시 뒤 사용자들이 한 버킷을 공유하는 문제도 없다 (`createAuthenticatedProxy` 참고).
*   **회귀 방지**: `functions/src/__tests__/clientIp.test.ts`의 스푸핑 케이스.

### 1.6 Firestore 트리거가 Gemini를 부를 때 (필수 — 2026-08-14 감사 발견 1)

*   **규칙**: 트리거의 방아쇠가 **클라이언트가 생성할 수 있는 문서**라면, 호출 횟수 상한을 **트리거 안에** 둔다. 콜러블용 rate limit은 트리거에 닿지 않고, Security Rules는 "한 번에 얼마나 큰 일을 시키는가"는 막아도 "몇 번 시키는가"는 표현하지 못한다.
*   **짝을 이뤄야 한다**:
    1.  Rules — 작성자 명의 강제, 첨부 개수·본문 길이 상한 (쓰기 1건의 크기)
    2.  트리거 — 작성자별 + 전역 일일 쿼터, 둘 다 fail-closed (쓰기 횟수)
*   **구현 예**: `feedbacks` → `generateFeedbackDraft`의 `consumeAiDraftQuota`, `firestore.rules`의 feedbacks create, `tests/firestore-rules.test.ts` 11번 케이스.

### 1.7 서버가 대신 가져오는 URL (필수 — 2026-08-14 감사 발견 3)

*   **규칙**: 프롬프트에 붙일 이미지를 URL로 받아 서버가 fetch할 때는 **스킴(https)과 호스트를 화이트리스트로 강제**한다. 사용자 문서의 필드를 그대로 fetch하면 내부망·제3자로 향하는 SSRF 통로이자 대역폭 증폭 통로가 된다.
*   **구현**: `isAllowedPromptImageUrl()` / `fetchPromptImages()` (`utils/helpers.ts`), 회귀 방지 `functions/src/__tests__/promptImageUrl.test.ts`.

---

## 2. Storage 업로드 보안 규칙 (Security Rules)

> 정본은 `storage.rules`다. 수정 절차는 [firestore-rules §4](firestore-rules.md) 참고.

*   **OCR 계기판 이미지는 Storage를 거치지 않는다** — base64로 `ocrDashboard` 콜러블에 직접 전달된다(`src/hooks/useDriveLogOcr.ts`). Storage에 올라가는 것은 OCR 인식 오류 **신고** 이미지뿐이다.
*   현재 열려 있는 경로는 세 곳뿐이며, 전부 단일 파일 수준(`{fileName}`)으로 좁게 매치한다. 와일드카드(`{allPaths=**}`) 허용 매치는 없다:
    *   `organizations/{orgId}/{fileName}` — 기관 고유번호증 사본(정부 발급 PII). **읽기는 superAdmin 전용, 클라이언트 쓰기는 전면 차단**(`write: if false`). 업로드는 Admin SDK(`submitOrgApplication`)가, 표시는 단기 서명 URL(`getOrgDocumentUrl`)이 담당한다. org 멤버 직접 읽기는 불필요한 PII 노출 표면이라 **의도적으로 제거됐다 (2026-07-18 보안 재점검 B). 다시 열지 않는다.**
    *   `feedbacks/ocr-report/{userId}/{fileName}` — OCR 오류 신고 이미지. 본인 폴더만 read/write, 5MB·`image/*` 제한.
    *   `feedbacks/{userId}/{fileName}` — 일반 피드백 이미지. 동일 제한.
*   새 업로드 경로가 필요하면 feedbacks 패턴처럼 **소유자 검증 + 크기 + contentType 제한**을 전부 갖춘 좁은 매치로 추가한다.

---

## 3. 예외 상황 처리 및 UX 정책

1.  **API 할당량 초과 시**:
    *   Google Cloud Console의 API 쿼터 한도가 모두 차서 `Gemini API quota exceeded` 관련 에러가 발생한 경우, 서버는 이를 감지하여 사용자에게 시스템 장애가 아닌 "현재 AI 서버 사용량이 많아 분석이 지연되고 있습니다. 잠시 후 다시 시도해 주세요"라는 정제된 안내 문구를 반환해야 합니다.
2.  **수동 입력 대체 경로 제공**:
    *   OCR 분석이 실패하거나 API 호출이 불가능하더라도, 사용자가 수동으로 계기판 Km나 텍스트를 입력하여 차량운행일지 작성을 완료할 수 있도록 대체 UI 경로를 항상 보장해야 합니다.
