---
description: Cloud Functions 코딩 컨벤션. functions/ 디렉터리의 코드를 작성하거나 수정할 때 반드시 따른다.
---

# ☁️ Cloud Functions 코딩 컨벤션

이 문서는 `functions/` 디렉터리의 Cloud Functions 백엔드 코드를 작성할 때 따라야 할 규칙이다.

> 프론트엔드(React) 코드 규칙은 `coding-conventions.md`를 참고한다.

---

## 1. 기술 스택

- **런타임**: Node.js 22 (`engines.node: "22"`)
- **모듈 시스템**: TypeScript ESM (`import` / `export`)
- **Firebase**: `firebase-admin`, `firebase-functions` v6 (2nd gen)
- **주요 라이브러리**: `googleapis`, `@google/genai`, `@emailjs/nodejs`

---

## 2. 파일 구조 규칙

### 2.1 모듈 분리 원칙

- **1개 파일 = 1개 기능 영역**: 파일 이름이 기능을 대표 (예: `ocrDocument.ts`, `tmapProxy.ts`)
- **index.ts는 등록만**: 비즈니스 로직 없이 `import` + `export` 만 작성
- **헬퍼 모듈**: 여러 함수에서 공유하는 로직은 별도 파일로 분리 (예: `calendarSync.ts`, `helpers.ts`)

### 2.2 index.ts 등록 패턴

```ts
// 섹션 주석으로 그룹핑
// ========================
// 기능 이름 (한글)
// ========================
export { functionName } from "./fileName";
```

### 2.3 Firebase Admin 초기화

```ts
// index.ts에서 최초 1회만 호출
import { initializeApp } from "firebase-admin/app";
initializeApp();

// 개별 모듈에서는 서비스만 가져옴
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore();
```

---

## 3. 함수 유형별 설정

### 3.1 HTTP 함수

```ts
import { onRequest } from "firebase-functions/v2/https";

export const myFunction = onRequest(
    {
        region: "asia-northeast3",
        cors: true,
    },
    async (req, res) => { ... }
);
```

- **리전**: `asia-northeast3` (서울) 고정
- **CORS**: `cors: true` 필수
- **메모리/타임아웃**: 무거운 작업은 명시 (`memory: "512MiB"`, `timeoutSeconds: 120`)

### 3.2 스케줄 함수

```ts
import { onSchedule } from "firebase-functions/v2/scheduler";

export const mySchedule = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async () => { ... }
);
```

- **타임존**: `Asia/Seoul` 고정
- **retryCount**: 일반적으로 `0` (중복 실행 방지)

### 3.3 Firestore 트리거

```ts
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted }
    from "firebase-functions/v2/firestore";
```

- **무한 루프 방지**: 트리거가 같은 문서를 수정하는 경우, `syncSource` 같은 플래그로 제어
- **calendarEventId 패턴**: 외부 ID를 Firestore에 저장할 때, 해당 업데이트가 트리거를 다시 호출하지 않도록 조건 추가

---

## 4. 에러 처리

```ts
try {
    // 비즈니스 로직
    console.log("성공 메시지:", docId);
} catch (err: unknown) {
    console.error("실패 설명:", (err as Error).message);
    // HTTP 함수: res.status(500).json({ error: (err as Error).message });
    // 트리거/스케줄: 에러를 로그만 남기고 throw 하지 않음 (재시도 방지)
}
```

### 에러 처리 규칙

1. **HTTP 함수**: try-catch로 감싸고 `res.status(500).json()`으로 응답
2. **트리거/스케줄 함수**: 개별 항목 처리 실패 시 로그만 남기고 계속 진행 (전체 실패 방지)
3. **로그 언어**: 영문 + 한글 혼용 허용 (Firebase 로그에서 검색 용이)

---

## 5. 환경변수

```bash
# functions/.env (배포 시 자동 적용)
TMAP_API_KEY=...
GOOGLE_GENAI_API_KEY=...
```

```ts
// 사용
const apiKey = process.env.TMAP_API_KEY;
```

> ⚠️ `.env` 파일은 `.gitignore`에 등록되어 있다. 새 환경변수 추가 시 팀원에게 공유 필요.

---

## 6. 푸시 알림 (sendNotification)

```ts
import { sendPushToOrg } from "./sendNotification";

// 특정 사용자 제외하고 기관 전체에 푸시
await sendPushToOrg(
    organizationId,
    { title: '알림 제목', body: '알림 내용' },
    excludeUid  // 선택: 이 UID는 알림에서 제외
);
```

---

## 7. 알림톡 발송 (sendAlimtalk)

카카오 알림톡은 Cafe24 PHP 프록시를 경유하여 알리고 API로 전송한다.

```ts
import { sendApprovalAlimtalk, sendReminderAlimtalk } from "./sendAlimtalk";

// 기관 승인 시 알림톡
await sendApprovalAlimtalk(phoneNumber, inviteCode);

// 미활성 기관 리마인드 알림톡
await sendReminderAlimtalk(phoneNumber, inviteCode);
```

### 환경변수

```bash
# functions/.env
ALIMTALK_PROXY_URL=https://example.cafe24.com/send_alimtalk_vehicle_drive_log_proxy.php
ALIMTALK_PROXY_TOKEN=your-api-token
```

### 주의사항

1. PHP 프록시 호출 시 `X-API-Token` 헤더 필수
2. 전화번호는 하이픈 제거 후 전송 (헬퍼 내부에서 자동 처리)
3. 알리고 템플릿과 메시지 본문이 정확히 일치해야 함 (줄바꿈 LF 기준)
4. `tpl_code` 파라미터로 템플릿 지정

---

## 8. 배포

```bash
# Functions만 배포
firebase deploy --only functions

# 특정 함수만 배포
firebase deploy --only functions:functionName
```

> ⚠️ 배포 전 반드시 Node 22 확인: `fnm use 22 && node --version`
