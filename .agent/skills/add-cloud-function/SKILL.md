---
name: add-cloud-function
description: functions/src/ 디렉터리에 새 Cloud Function을 추가하고 index.ts에 등록하는 패턴 가이드
---

# Cloud Function 추가 스킬

## functions/src/ 디렉터리 구조

```
functions/
├── src/
│   ├── index.ts                     ← 엔트리 (모든 Cloud Function을 re-export)
│   ├── helpers.ts                   ← 공통 유틸 (severity 로깅, 에러 자동 래퍼)
│   ├── verifyHelpers.ts             ← AI 문서 검증 및 OCR 관련 종합 복합 헬퍼
│   ├── constants.ts                 ← Remote Config 및 시스템 공통 상수
│   │
│   ├── ocrDashboard.ts              ← onCall (계기판 사진 OCR 분석)
│   ├── ocrDocument.ts               ← onCall / Helper (고유번호증 OCR 분석)
│   ├── autoVerifyDocument.ts        ← Firestore 트리거 (기관 신청 시 AI 자동 증빙 검증)
│   ├── askAI.ts                     ← onCall (AI 질의 비서 응답 처리)
│   ├── generateFeedbackDraft.ts     ← onCall (사용자 피드백 AI 답변 초안 자동 생성)
│   ├── regenerateFeedbackDraft.ts   ← onCall (AI 답변 초안 재생성)
│   │
│   ├── createReservationSafe.ts     ← onCall (동시성 중복 예약 차단 생성)
│   ├── sendAdminNotice.ts           ← onCall (관리자 공지 및 전체 FCM 푸시 발송)
│   ├── sendAlimtalk.ts              ← Helper (카카오 알림톡 전송 외부 API 연동)
│   ├── sendManualApprovalAlimtalk.ts← onCall (수동 승인/반려 알림톡 발송)
│   ├── sendNotification.ts          ← Helper (FCM 알림 푸시 전송 핵심 모듈)
│   ├── notifyNewApplication.ts      ← Firestore 트리거 (신규 신청서 등록 시 슈퍼관리자 알림)
│   ├── notifyRoleChange.ts          ← Firestore 트리거 (유저 권한/역할 변경 알림)
│   ├── sendApprovalEmail.ts         ← Helper (기관 신청 승인 메일 발송)
│   ├── sendRejectionEmail.ts        ← Helper (기관 신청 반려 메일 발송)
│   ├── sendFeedbackReply.ts         ← onCall (피드백 답변 완료 알림 발송)
│   │
│   ├── calendarSync.ts              ← Helper (Google Calendar 단방향/양방향 연동 헬퍼)
│   ├── calendarSchedule.ts          ← Schedule (Google Calendar 10분 주기 역동기화)
│   ├── testCalendarAccess.ts        ← onCall (캘린더 연동 디버깅 및 API 테스트)
│   ├── triggerOnDemandCalendarSync.ts← onCall (수동 즉시 캘린더 동기화 요청)
│   ├── reservationTriggers.ts       ← Firestore 트리거 (예약 생성/수정/삭제 시 연동 처리)
│   ├── reservationReminder.ts       ← Schedule (예약 시작 임박 리마인더 알림 배치)
│   │
│   ├── holidayProxy.ts              ← HTTP (공공 휴일 Open API 프록시)
│   ├── tmapProxy.ts                 ← HTTP (Tmap API 경로/거리 계산 프록시)
│   ├── syncHolidays.ts              ← Schedule (매년 공휴일 자동 동기화 배치)
│   ├── warmupOcr.ts                 ← Helper (OCR 웜업 — reservationReminder 스케줄러에 편승 호출)
│   │
│   ├── backupFirestore.ts           ← Schedule (Firestore 스토리지 일일 백업 배치)
│   ├── dailyNightlyBatch.ts         ← Schedule (야간 데이터 정리 및 백그라운드 통합 배치)
│   ├── cleanupDuplicateLogs.ts      ← HTTP (중복 운행일지 검출 및 보정 자동화)
│   ├── syncDriveLogKm.ts            ← HTTP / onCall (전체 운행일지 누적거리 오차 보정 동기화)
│   ├── updateDriveLogStats.ts       ← Firestore 트리거 (운행일지 등록 시 통계 실시간 집계)
│   │
│   ├── disableUser.ts               ← onCall (유저 계정 비활성화 처리)
│   ├── restoreUser.ts               ← onCall (유저 계정 복원 처리)
│   ├── onUserDelete.ts              ← Firestore 트리거 (유저 정보 영구 삭제 시 리소스 연쇄 정리)
│   ├── setCustomClaims.ts           ← Firestore 트리거 (유저 Auth Claims 권한 실시간 동기화)
│   ├── joinOrganization.ts          ← onCall (기관 초대 코드 서버사이드 검증 및 소속 승인)
│   ├── submitOrgApplication.ts      ← onCall (신규 기관 가입 신청 양식 검증 제출)
│   ├── submitPublicFeedback.ts      ← onCall (비로그인 사용자 피드백 접수 검증)
│   ├── trackFirstEmployee.ts        ← Firestore 트리거 (최초 가입 직원 판별 및 관리자 알림)
│   │
│   ├── rateLimit.ts                 ← Helper (API 레이트 리밋 스로틀링 모듈)
│   ├── discord.ts                   ← Helper (디스코드 웹훅 알림 송신 유틸)
│   ├── discordScheduler.ts          ← Schedule (디스코드 시스템 상태 주기 요약 리포트 배치)
│   ├── apiHealthCheck.ts            ← onCall / HTTP (외부 API 모니터링 및 헬스 체크)
│   ├── sendInactiveOrgAlimtalkScheduled.ts← Schedule (장기 미사용 기관 리마인드 알림 배치)
│   │
│   ├── caching/                     ← 캐싱 관련 서브 모듈
│   ├── scheduler/                   ← 스케줄러 래퍼 및 설정 모듈
│   ├── scripts/                     ← 서버 관리 및 마이그레이션 배치 스크립트
│   └── __tests__/                   ← Cloud Functions 단위/통합 테스트
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
7. **멱등성(Idempotency)**: 스케줄 함수는 타임아웃이나 재시도 시 동일한 작업이 중복 실행되어도 문제없도록(예: 발송 완료 상태 기록 확인 등) 설계한다
8. **공휴일/휴일 예외**: 비즈니스 데스크 업무와 연관된 알림은, 필요시 공휴일을 체크하여 발송을 스킵하거나 익일로 미룬다

## 배포 및 검증

```bash
# Functions만 배포 (/deploy-functions 워크플로우 사용)
firebase deploy --only functions

# 로그 확인 (/logs 워크플로우 사용)
firebase functions:log --limit 50
```
