/**
 * backfillMonthlyStats — 월별 집계(orgStats/{orgId}/monthly) 소급 재집계 (일회성 백필, superAdmin 전용)
 *
 * 야간 배치(runDailyAggregation)는 당월+전월만 갱신하므로, 집계 로직 변경 후 과거 월을 즉시
 * 교정하려면 이 콜러블을 1회 호출한다. set(merge)라 멱등하며, 타임아웃 시 재호출해도 안전하다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireSuperAdmin } from "../../utils/helpers";
import { runDailyAggregation } from "../scheduled/dailyAggregation";

export const backfillMonthlyStats = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async (request) => {
        requireSuperAdmin(request);

        // 재집계할 최근 개월 수 (기본 6 = 분석 대시보드 기본 창), 안전 범위로 클램프
        const raw = Number((request.data as { months?: number } | undefined)?.months);
        const months = Number.isFinite(raw) ? Math.min(24, Math.max(1, Math.floor(raw))) : 6;

        console.log(`[backfillMonthlyStats] 최근 ${months}개월 소급 재집계 시작 (uid=${request.auth.uid})`);
        const startedAt = Date.now();
        let summary;
        try {
            summary = await runDailyAggregation(months);
        } catch (err: unknown) {
            console.error("[backfillMonthlyStats] 실패:", (err as Error).message);
            throw new HttpsError("internal", "월별 집계 백필 중 오류가 발생했습니다.");
        }
        const durationMs = Date.now() - startedAt;
        console.log(`[backfillMonthlyStats] 완료 — 기관 ${summary.orgs}, 성공 ${summary.processed}, 실패 ${summary.errors} (${durationMs}ms)`);

        // 일부 기관이라도 집계에 실패하면 success=false로 알린다(조용한 실패 방지)
        return {
            success: summary.errors === 0,
            months,
            orgs: summary.orgs,
            processed: summary.processed,
            errors: summary.errors,
            durationMs,
        };
    },
);
