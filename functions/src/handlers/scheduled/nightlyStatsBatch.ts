/**
 * nightlyStatsBatch — 매일 02:00(KST) 통계 집계 배치
 *
 * 1. dailyAggregation: 전체 기관 × 최근 2개월 운행일지 집계 → orgStats/{orgId}/monthly
 * 2. computeAllDashboardStats: superAdmin 대시보드 통계 캐시 재집계
 *
 * ## 왜 백업과 분리했나
 * 원래 이 둘은 dailyNightlyBatch의 Step 0·0.5였다. 두 스텝이 문서 수만 건을 한 프로세스에
 * 올린 상태에서 뒤이어 백업이 gRPC Admin 클라이언트를 새로 만들다 2026-08-15에
 * `Memory limit of 512 MiB exceeded`로 인스턴스째 죽었고, 그 강제 종료가 retryCount 재실행을
 * 불러 배치가 하루 두 번 돌았다. 당시엔 메모리를 1GiB로 올려 막았지만, 그 대가로 **성격이 다른
 * 일곱 스텝 전부가** 1GiB로 최대 540초를 돌게 됐다 (2026-08-28 Cloud Run 비용 점검에서
 * 청구 대상 인스턴스 시간 1위).
 *
 * 메모리를 키우는 대신 프로세스를 나눈다. 집계와 백업이 메모리를 나눠 쓰지 않으므로 각자
 * 512MiB로 충분하고, 한쪽이 죽어도 다른 쪽을 재실행하지 않는다.
 *
 * `retryCount: 0` — 집계는 멱등하지만 재실행 비용이 그대로 두 배다. 하루 놓쳐도 다음 날
 * 배치가 같은 창(최근 2개월)을 다시 집계해 스스로 메운다. (rules/cloud-functions.md §3.1)
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { runDailyAggregation } from "./dailyAggregation";
import { computeAllDashboardStats } from "../../services/statistics/computeDashboardStats";
import { runStep, logBatchResult } from "../../utils/batchStep";

const CONTEXT = "nightlyStatsBatch";

export const nightlyStatsBatch = onSchedule(
    {
        // 02:00을 유지한다 — dailyAggregation은 실행 시점 -3시간을 기준월로 삼으므로
        // (getRecentMonthWindows) 이 시각이 바뀌면 매월 1일의 집계 대상 월이 달라진다.
        schedule: "0 2 * * *",
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        const failed: string[] = [];

        await runStep(failed, CONTEXT, "dailyAggregation", () => runDailyAggregation());
        await runStep(failed, CONTEXT, "computeAllDashboardStats", () => computeAllDashboardStats());

        logBatchResult(CONTEXT, failed);
    }
);
