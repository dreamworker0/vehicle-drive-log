# 🛡️ Gemini OCR 비용 통제 및 이미지 업로드 보안 규칙

이 규칙은 AI API(Gemini OCR) 호출로 인한 비정상적인 비용 청구를 예방하고, 업로드된 민감 증빙 서류 이미지의 불법적인 접근을 차단하기 위한 필수 아키텍처 규칙입니다.

---

## 1. OCR API 비용 통제 (Rate Limit)

Gemini API 호출은 종량제 비용이 발생하므로, 악의적이거나 비정상적인 반복 호출을 차단하기 위해 **반드시 서버사이드(Cloud Functions)에서 호출 제한 검증 로직을 수행**해야 합니다.

### 1.1 일일 호출 제한 강제
*   **규칙**: 사용자의 UID 또는 조직 ID(`organizationId`)를 기준으로, 하루 동안 허용되는 OCR 호출 최대 횟수를 제한합니다.
    *   **기준값**: 사용자당 일일 최대 **20회**, 조직당 일일 최대 **50회** (프로젝트 환경에 따라 조율 가능).
*   **구현 방법**:
    *   호출 시 Firestore의 일일 카운터 문서(예: `organizations/{orgId}/usage/ocrCounter`)를 조회 또는 업데이트(Increment)하여 제한을 검증합니다.
    *   초과 시 즉시 `functions.https.HttpsError("resource-exhausted", "일일 OCR 호출 한도를 초과했습니다.")` 에러를 반환해야 합니다.

### 1.2 프론트엔드 중복 클릭 방지 (Debounce/Throttle)
*   **규칙**: 프론트엔드에서 이미지 업로드 및 분석 버튼을 누른 후, 응답이 올 때까지 버튼을 비활성화(`disabled`)하고 스피너를 보여주어 중복 API 호출을 원천 차단해야 합니다.

---

## 2. Storage 업로드 보안 규칙 (Security Rules)

사용자가 계기판이나 증빙서류를 업로드할 때, 타 조직 사용자에게 개인정보 및 민감 데이터가 유출되지 않도록 Firebase Storage 경로와 규칙을 강력하게 제한합니다.

### 2.1 디렉토리 격리 구조
모든 OCR 대상 이미지는 아래와 같이 **조직 ID를 포함하는 격리 경로**에만 업로드될 수 있습니다.
*   **계기판 이미지**: `organizations/{orgId}/vehicles/{vehicleId}/dashboard_ocr/{fileName}`
*   **고유번호증/증빙 서류**: `organizations/{orgId}/verifications/{fileName}`

### 2.2 Storage Security Rules 작성 지침
`storage.rules`에서 타 조직의 사용자가 격리 폴더에 접근하는 것을 완벽히 제한합니다.

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // 조직 격리 폴더 규칙
    match /organizations/{orgId}/{allPaths=**} {
      // 로그인된 사용자이고, 토큰의 organizationId가 해당 경로의 orgId와 일치하는 경우에만 허용
      allow read, write: if request.auth != null && 
                          request.auth.token.organizationId == orgId;
    }
  }
}
```

---

## 3. 예외 상황 처리 및 UX 정책

1.  **API 할당량 초과 시**:
    *   Google Cloud Console의 API 쿼터 한도가 모두 차서 `Gemini API quota exceeded` 관련 에러가 발생한 경우, 서버는 이를 감지하여 사용자에게 시스템 장애가 아닌 "현재 AI 서버 사용량이 많아 분석이 지연되고 있습니다. 잠시 후 다시 시도해 주세요"라는 정제된 안내 문구를 반환해야 합니다.
2.  **수동 입력 대체 경로 제공**:
    *   OCR 분석이 실패하거나 API 호출이 불가능하더라도, 사용자가 수동으로 계기판 Km나 텍스트를 입력하여 차량운행일지 작성을 완료할 수 있도록 대체 UI 경로를 항상 보장해야 합니다.
