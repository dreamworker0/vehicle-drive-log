---
name: add-scheduler-job
description: Firebase Pub/Sub 기반의 정기 스케줄러(Cron Job) 함수를 추가하고 등록하는 패턴 가이드
---
# Firebase Pub/Sub 스케줄러 잡 추가 가이드 (add-scheduler-job)

새로운 정기 작업(예: 주간/월간 리포트, 미활동 알림 등)을 추가할 때 참고하는 스킬 가이드입니다.

## 1. 파일 생성 위치
스케줄러 함수는 `functions/src/` 내에 목적에 맞는 디렉토리 혹은 별도 파일로 생성합니다.
(예: `functions/src/scheduler/weeklyInactiveNotice.ts`)

## 2. 함수 템플릿 패턴
Firebase v2 함수의 `onSchedule`을 사용합니다. 반드시 한국 시간대(Asia/Seoul)를 기준으로 작성하세요.

```typescript
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

export const scheduledMyJob = onSchedule(
  {
    schedule: "0 14 * * 1", // 월요일 오후 2시 (Cron 표현식)
    timeZone: "Asia/Seoul", 
    timeoutSeconds: 300,
    memory: "512MiB", // 처리할 작업량에 따라 최적화
  },
  async (event) => {
    try {
      logger.info("스케줄러 작업 시작: My Job");
      // TODO: 비즈니스 로직 작성
      logger.info("스케줄러 작업 완료");
    } catch (error) {
      logger.error("스케줄러 작업 실패", { error });
    }
  }
);
```

## 3. index.ts 등록
새로 만든 함수는 반드시 `functions/src/index.ts`에 export 해야 배포 시 인식됩니다.

## 4. 유의사항
- **멱등성(Idempotency)**: 타임아웃이나 재시도 시 동일한 작업이 중복 실행되어도 문제가 없도록(예: 발송 완료 상태 기록 확인 등) 설계하세요.
- **공휴일/휴일 예외**: 비즈니스 데스크 업무와 연관된 알림은, 필요시 공휴일을 체크하는 로직을 추가하여 발송을 스킵하거나 익일로 미룹니다.
