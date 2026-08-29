---
name: add-cloud-function
description: functions/src/ 디렉터리에 새 Cloud Function을 추가하고 index.ts에 등록하는 패턴 가이드
---

# Cloud Function 추가 스킬

## functions/src/ 디렉터리 구조

```
functions/src/
├── index.ts        ← 엔트리 (모든 Cloud Function을 re-export — 여기 없으면 배포 안 됨)
├── core/           ← 횡단 인프라 (sentry, mailer, discord, gemini, params 등)
├── handlers/       ← 함수 진입점 — callable/ · https/ · scheduled/ · sync/ · triggers/
├── services/       ← 도메인 비즈니스 로직 (driveLog, calendar, alimtalk 등)
├── utils/          ← 순수 유틸 (constants, helpers, rateLimit, clientIp 등)
├── scripts/        ← 서버 관리·마이그레이션 배치
└── __tests__/      ← 단위/통합 테스트
```

개별 파일 목록은 여기 적지 않는다 — **같은 유형의 기존 함수를 Glob/`ls`로 찾아 그 파일을 본뜬다.** 새 onCall이면 `handlers/callable/`의 기존 파일 옆에, 새 스케줄이면 `handlers/scheduled/` 옆에 만든다. 공용 로직은 `services/`·`core/`·`utils/`에서 먼저 찾는다.

## 함수 유형별 템플릿

### 1. onCall 함수

```ts
// handlers/callable/newFunction.ts
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
// handlers/https/newFunction.ts
import { onRequest } from "firebase-functions/v2/https";
import { wrapHttps } from "../../utils/helpers";

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
export { myFunction } from "./handlers/callable/newFunction";
```

> ⚠️ `index.ts`에서 export하지 않으면 배포되지 않는다.

## utils/helpers.ts 활용

공통 유틸리티(`functions/src/utils/helpers.ts`)를 적극 활용한다:

```ts
import { log, wrapHttps, wrapHandler } from "../../utils/helpers";

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

1. **모듈 문법**: 소스는 `import`/`export`로 쓴다. 다만 컴파일 결과는 CommonJS이므로 top-level await·`import.meta`는 쓸 수 없다 (`functions/tsconfig.json`의 `module: "commonjs"`)
2. **리전**: `asia-northeast3` (서울) 고정
3. **Node 버전**: 22 (package.json `engines.node`로 지정)
4. **Firebase Admin**: `index.ts`에서 한 번만 `initializeApp()`. 개별 모듈에서는 `getFirestore()`, `getAuth()` 등만 호출
5. **에러 타입**: `catch (err: unknown)` → `(err as Error).message` 패턴
6. **CORS**: HTTP 함수는 `cors: true` 옵션 사용
7. **멱등성(Idempotency)**: 스케줄 함수는 타임아웃이나 재시도 시 동일한 작업이 중복 실행되어도 문제없도록(예: 발송 완료 상태 기록 확인 등) 설계한다
8. **공휴일/휴일 예외**: 비즈니스 데스크 업무와 연관된 알림은, 필요시 공휴일을 체크하여 발송을 스킵하거나 익일로 미룬다

## 배포 및 검증

배포는 로컬에서 직접 하지 않는다 — master 푸시 시 CI(Deploy 워크플로)가 수행한다. 긴급 시에만 `/deploy-functions` 워크플로우를 따른다.

```bash
# 로그 확인 (/logs 워크플로우 사용)
firebase functions:log --limit 50
```
