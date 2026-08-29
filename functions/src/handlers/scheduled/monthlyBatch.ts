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
        // CPU 분수 할당 — firebase-functions v2는 메모리와 무관하게 모든 함수에 1 vCPU를 붙인다
        // (options.d.ts: "Defaults to 1 for functions with <= 2GB RAM"). Cloud Run 요금은 vCPU-초가
        // GiB-초보다 약 10배 비싸므로 여기가 실질 지렛대다. gcf_gen1은 gen1의 분수 CPU로 되돌린다.
        // 이 함수는 외부 API·Firestore 응답을 기다리는 시간이 대부분이라 CPU를 줄여도 소요가 그만큼
        // 늘지 않는다. concurrency는 cpu<1이면 1이어야 하는데, 스케줄 함수는 한 번에 한 번만 도니
        // 손해가 없다. **전역 concurrency(80)를 그대로 두면 배포가 거부되므로 반드시 명시한다.**
        // (2026-08-29 Cloud Run 비용 점검 — 야간 배치 3종은 타임아웃 여유가 없어 제외했다)
        cpu: "gcf_gen1",
        concurrency: 1,
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
