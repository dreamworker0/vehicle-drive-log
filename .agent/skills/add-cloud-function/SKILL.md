---
name: add-cloud-function
description: functions/ 디렉터리에 새 Cloud Function을 추가하고 index.js에 등록하는 패턴 가이드
---

# Cloud Function 추가 스킬

## functions/ 디렉터리 구조

```
functions/
├── index.js              ← 엔트리 (모든 함수를 require → exports)
├── package.json          ← Node 22, firebase-functions v6
├── .env                  ← 환경변수 (API 키 등)
│
├── ocrDashboard.js       ← onCall 함수 (계기판 OCR)
├── ocrDocument.js        ← Firestore 트리거 (고유번호증 OCR, autoVerifyDocument에서 호출)
├── createReservationSafe.js ← onCall 함수 (서버 측 중복 검증 예약 생성)
├── sendAdminNotice.js    ← onCall 함수 (관리자 공지 발송)
├── holidayProxy.js       ← HTTP 프록시 함수
├── tmapProxy.js          ← HTTP 프록시 함수
├── warmupOcr.js          ← 스케줄 로직 (콜드 스타트 방지)
│
├── calendarSync.js       ← 헬퍼 모듈 (Google Calendar 연동, 함수 등록 X)
├── sendNotification.js   ← 헬퍼 모듈 (FCM 푸시 알림)
│
├── autoVerifyDocument.js ← Firestore 트리거 (기관 신청 AI 자동 검증)
├── notifyNewApplication.js ← Firestore 트리거 (신규 신청 시 슈퍼관리자 푸시)
│
├── syncHolidays.js       ← 스케줄 함수 (공휴일 동기화)
├── reservationReminder.js← 스케줄 로직 (예약 알림, index.js에서 onSchedule 래핑)
├── backupFirestore.js    ← 스케줄 함수 (Firestore 백업)
├── autoPurgeOrgs.js      ← 스케줄 함수 (삭제된 기관 자동 퍼지)
└── archiveDriveLogs.js   ← 스케줄 함수 (운행기록 아카이빙)
```

## 함수 유형별 템플릿

### 1. onCall 함수

```js
// newFunction.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");

exports.myFunction = onCall(
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
            return { success: true, data: result };
        } catch (err) {
            console.error("myFunction 실패:", err.message);
            throw new HttpsError("internal", err.message);
        }
    }
);
```

### 2. HTTP 함수 (onRequest)

```js
// newFunction.js
const { onRequest } = require("firebase-functions/v2/https");

exports.myFunction = onRequest(
    {
        region: "asia-northeast3",
        cors: true,
        // 필요 시: memory: "512MiB", timeoutSeconds: 120
    },
    async (req, res) => {
        try {
            // 비즈니스 로직
            res.json({ success: true, data: result });
        } catch (err) {
            console.error("myFunction 실패:", err.message);
            res.status(500).json({ error: err.message });
        }
    }
);
```

### 3. 스케줄 함수 (onSchedule)

```js
// 방법 A: 모듈에서 직접 onSchedule 래핑
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.myScheduledFn = onSchedule(
    {
        schedule: "every 1 hours",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async function () {
        // 비즈니스 로직
    }
);

// 방법 B: 로직 함수만 export, index.js에서 onSchedule 래핑
exports.myScheduledLogic = async function () {
    // 비즈니스 로직
};
```

### 4. Firestore 트리거

```js
const { onDocumentCreated } = require("firebase-functions/v2/firestore");

exports.onItemCreated = onDocumentCreated(
    "collectionName/{docId}",
    async (event) => {
        const data = event.data.data();
        const docId = event.params.docId;

        try {
            // 비즈니스 로직
            console.log("처리 완료:", docId);
        } catch (err) {
            console.error("처리 실패:", docId, err.message);
        }
    }
);
```

## index.js 등록 절차

새 파일을 만들었으면 `index.js`에 등록합니다:

```js
// 섹션 주석으로 그룹핑
// ========================
// 새 기능 이름
// ========================
const { myFunction } = require("./newFunction");
exports.myFunction = myFunction;
```

> ⚠️ `index.js`에서 `exports`에 등록하지 않으면 배포되지 않는다.

## 환경변수

API 키 등은 `functions/.env` 파일에 추가합니다:

```bash
# functions/.env
MY_API_KEY=abcdef123456
```

코드에서 사용:
```js
const apiKey = process.env.MY_API_KEY;
```

## 주의사항

1. **CommonJS 사용**: functions 디렉터리는 `"type": "module"`이 아니므로 `require/module.exports` 사용
2. **리전**: `asia-northeast3` (서울) 고정
3. **Node 버전**: 22 (package.json `engines.node`로 지정)
4. **Firebase Admin**: `index.js`에서 한 번만 초기화. 개별 모듈에서는 `getFirestore()` 등만 호출
5. **에러 로깅**: `console.error('한글 설명:', err.message)` 형식
6. **CORS**: HTTP 함수는 `cors: true` 옵션 사용

## 배포 및 검증

```bash
# Functions만 배포 (/deploy-functions 워크플로우 사용)
firebase deploy --only functions

# 로그 확인 (/logs 워크플로우 사용)
firebase functions:log --limit 50
```
