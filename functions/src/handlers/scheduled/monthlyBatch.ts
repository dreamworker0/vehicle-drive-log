/**
 * monthlyBatch — 매월 1일 06:00(KST) 통합 월배치 작업
 *
 * 기존 개별 월간 스케줄러들을 통합하여 Cloud Scheduler 잡 수(=과금) 절감:
 * 1. syncHolidays: 공공데이터 포털 공휴일 정보 동기화
 * 2. verifyMileageConsistency: 차량별 누적 주행거리(마일리지) 불일치 검증
 *
 * 각 단계는 독립적으로 try/catch 하여 한 단계의 실패가 다른 단계로 전파되지 않게 한다.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { syncHolidays } from "./syncHolidays";
import { verifyMileageConsistency } from "./verifyMileageConsistency";

export const monthlyBatch = onSchedule(
    {
        schedule: "0 6 1 * *", // KST 매월 1일 06:00
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        // Step 1: 공휴일 동기화 (기존 syncHolidaysScheduled 통합)
        try {
            await syncHolidays();
        } catch (e: unknown) {
            console.error("[monthlyBatch] Error in syncHolidays:", (e as Error).message);
        }

        // Step 2: 마일리지 불일치 검증 (기존 verifyMileageConsistency 통합)
        try {
            await verifyMileageConsistency();
        } catch (e: unknown) {
            console.error("[monthlyBatch] Error in verifyMileageConsistency:", (e as Error).message);
        }

        console.log("[monthlyBatch] completed.");
    }
);
