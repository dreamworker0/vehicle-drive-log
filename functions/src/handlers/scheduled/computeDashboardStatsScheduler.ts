/**
 * computeDashboardStatsScheduler — 대시보드 통계 캐싱 스케줄러 (D13 규칙 준수: index.ts에서 분리)
 *
 * 매시간(08시~19시) SuperAdmin 대시보드 통계를 배치 계산하여 Firestore에 캐싱한다.
 * 수동 갱신은 refreshDashboardStats callable로도 가능.
 * 저녁 20시 ~ 아침 8시 사이에는 야간 유휴 시간 절감을 위해 스킵한다 (안전장치).
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { computeAllDashboardStats } from "../../services/statistics/computeDashboardStats";
import { recordHeartbeat } from "../../utils/helpers";

export const computeDashboardStats = onSchedule(
    {
        schedule: "0 8-19 * * *",
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 300,
    },
    async function () {
        // 저녁 20시 ~ 아침 8시 사이에는 통계 캐싱 스케줄러 실행을 완전히 건너뜀
        // (야간 유휴 시간 리소스 및 과금 절감)
        const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const hour = nowKST.getHours();

        if (hour >= 20 || hour < 8) {
            await recordHeartbeat("computeDashboardStats (skipped by night time policy)");
            return;
        }

        await computeAllDashboardStats();
        await recordHeartbeat("computeDashboardStats");
    }
);
