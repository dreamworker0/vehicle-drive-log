---
name: add-cloud-function
description: functions/src/ 디렉터리에 새 Cloud Function을 추가하고 index.ts에 등록하는 패턴 가이드
---

# Cloud Function 추가 스킬

## functions/src/ 디렉터리 구조

```
functions/
├── src/
│   ├── index.ts                     ← 엔트리 (모든 함수를 re-export)
│   ├── helpers.ts                   ← 공통 유틸 (구조화 로깅, 에러 래퍼)
│   │
│   ├── ocrDashboard.ts              ← onCall (계기판 OCR)
│   ├── ocrDocument.ts               ← 헬퍼 (고유번호증 OCR, autoVerifyDocument에서 호출)
│   ├── autoVerifyDocument.ts        ← Firestore 트리거 (기관 신청 AI 자동 검증)
│   ├── createReservationSafe.ts     ← onCall (서버사이드 중복 검증 예약 생성)
│   ├── sendAdminNotice.ts           ← onCall (관리자 공지 발송)
│   ├── sendAlimtalk.ts              ← 헬퍼 (카카오 알림톡 발송 — 승인/리마인드)
│   ├── sendManualApprovalAlimtalk.ts← onCall (수동 승인 알림톡 발송)
│   ├── sendNotification.ts          ← 헬퍼 (FCM 푸시 알림)
│   ├── notifyNewApplication.ts      ← Firestore 트리거 (신규 신청 시 슈퍼관리자 푸시)
│   │
│   ├── calendarSync.ts              ← 헬퍼 (Google Calendar 정방향 동기화)
│   ├── calendarSchedule.ts          ← 스케줄 (Google Calendar 역동기화, 10분 주기)
│   ├── reservationTriggers.ts       ← Firestore 트리거 (예약 생성/수정/삭제)
│   ├── reservationReminder.ts       ← 스케줄 로직 (예약 알림, index.ts에서 onSchedule 래핑)
│   │
│   ├── holidayProxy.ts              ← HTTP 프록시 함수
│   ├── tmapProxy.ts                 ← HTTP 프록시 함수
│   ├── syncHolidays.ts              ← 스케줄 (공휴일 동기화)
│   ├── warmupOcr.ts                 ← 스케줄 로직 (콜드 스타트 방지)
│   │
│   ├── backupFirestore.ts           ← 스케줄 (Firestore 백업)
│   ├── autoPurgeOrgs.ts             ← 스케줄 (삭제 기관 자동 퍼지)
│   ├── archiveDriveLogs.ts          ← 스케줄 (운행기록 아카이빙)
│   ├── cleanupDuplicateLogs.ts      ← HTTP (중복 운행기록 정리)
│   │
│   ├── disableUser.ts               ← onCall (사용자 비활성화)
│   ├── restoreUser.ts               ← onCall (사용자 복원)
│   ├── setCustomClaims.ts           ← Firestore 트리거 (Custom Claims 자동 동기화)
│   ├── joinOrganization.ts          ← onCall (기관 가입 서버사이드 검증)
│   ├── rateLimit.ts                 ← 헬퍼 (Cloud Functions 레이트 리밋)
│   ├── constants.ts                 ← 헬퍼 (Remote Config 레이트 리밋 상수)
│   ├── createAuthenticatedProxy.ts  ← 헬퍼 (인증 프록시 팩토리)
│   ├── sentry.ts                    ← 헬퍼 (Sentry 초기화)
│   ├── cleanupCertificateImages.ts  ← 스케줄 (인증서 이미지 정리)
│   ├── trackFirstEmployee.ts       ← Firestore 트리거 (첫 직원 가입 추적)
│   ├── backfillOrgCoords.ts        ← HTTP (기관 좌표 백필)
│   ├── sendApprovalEmail.ts        ← 헬퍼 (승인 이메일 발송)
│   │
│   └── __tests__/                   ← Cloud Functions 테스트
├── package.json                     ← Node 22, firebase-functions v6, TypeScript
└── tsconfig.json
```

## 함수 유형별 템플릿

### 1. onCall 함수

```ts
// newFunction.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

export const myFunction = onCall(
    {
        region: "asia-northeast3",
        // 필요 시: memory: "512MiB", timeoutSeconds: 60
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { param1, param2 } = request.data;

        try {
            // 비즈니스 로직
            return { success: true };
        } catch (err: unknown) {
            console.error("myFunction 실패:", (err as Error).message);
            throw new HttpsError("internal", "처리에 실패했습니다.");
        }
    }
);
```

### 2. HTTP 함수 (onRequest)

```ts
// newFunction.ts
import { onRequest } from "firebase-functions/v2/https";
import { wrapHttps } from "./helpers";

export const myFunction = onRequest(
    {
        region: "asia-northeast3",
        cors: true,
    },
    wrapHttps("myFunction", async (req, res) => {
        // 비즈니스 로직
        res.json({ success: true });
    })
);
```

### 3. 스케줄 함수 (onSchedule)

```ts
// 방법 A: 모듈에서 직접 onSchedule 래핑
import { onSchedule } from "firebase-functions/v2/scheduler";

export const myScheduledFn = onSchedule(
    {
        schedule: "every 1 hours",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async () => {
        // 비즈니스 로직
    }
);

// 방법 B: 로직 함수만 export, index.ts에서 onSchedule 래핑
export async function myScheduledLogic(): Promise<void> {
    // 비즈니스 로직
}
```

### 4. Firestore 트리거

```ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";

export const onItemCreated = onDocumentCreated(
    "collectionName/{docId}",
    async (event) => {
        const data = event.data?.data();
        const docId = event.params.docId;

        if (!data) return;

        try {
            // 비즈니스 로직
            console.log("처리 완료:", docId);
        } catch (err: unknown) {
            console.error("처리 실패:", docId, (err as Error).message);
        }
    }
);
```

## index.ts 등록 절차

새 파일을 만들었으면 `index.ts`에서 re-export합니다:

```ts
// 섹션 주석으로 그룹핑
// 새 기능 이름
export { myFunction } from "./newFunction";
```

> ⚠️ `index.ts`에서 export하지 않으면 배포되지 않는다.

## helpers.ts 활용

공통 유틸리티를 적극 활용한다:

```ts
import { log, wrapHttps, wrapHandler } from "./helpers";

// 구조화 로깅 (Cloud Logging severity 기반 필터링)
log("INFO", "myFunction", "처리 시작", { userId: "abc" });
log("ERROR", "myFunction", "실패", { stack: error.stack });

// HTTP 핸들러 에러 자동 래핑
wrapHttps("myFunction", async (req, res) => { ... });

// onCall/트리거 핸들러 에러 자동 래핑
wrapHandler("myFunction", async (...args) => { ... });
```

## 환경변수

API 키 등은 `functions/.env` 파일에 추가합니다:

```bash
# functions/.env
MY_API_KEY=abcdef123456
```

코드에서 사용:
```ts
const apiKey = process.env.MY_API_KEY;
```

## 주의사항

1. **TypeScript ESM**: `import/export` 사용 (CommonJS 아님)
2. **리전**: `asia-northeast3` (서울) 고정
3. **Node 버전**: 22 (package.json `engines.node`로 지정)
4. **Firebase Admin**: `index.ts`에서 한 번만 `initializeApp()`. 개별 모듈에서는 `getFirestore()`, `getAuth()` 등만 호출
5. **에러 타입**: `catch (err: unknown)` → `(err as Error).message` 패턴
6. **CORS**: HTTP 함수는 `cors: true` 옵션 사용

## 배포 및 검증

```bash
# Functions만 배포 (/deploy-functions 워크플로우 사용)
firebase deploy --only functions

# 로그 확인 (/logs 워크플로우 사용)
firebase functions:log --limit 50
```
