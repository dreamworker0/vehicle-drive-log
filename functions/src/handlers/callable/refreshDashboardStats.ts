import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { computeAllDashboardStats } from "../../services/statistics/computeDashboardStats";

/**
 * 수동 갱신 최소 간격(초). 이 시간 내 재요청은 재집계를 생략하고 기존 캐시를 유지한다.
 * 재집계는 전역 풀스캔(수만 read)이므로, 연타·다중 superAdmin 동시 클릭이 곧바로 비용으로
 * 이어진다. 야간 배치(02:00)와 별개로 낮 시간 수동 재집계를 쿨다운 창당 1회로 묶는 방어선.
 */
const REFRESH_COOLDOWN_SEC = 5 * 60; // 5분

/**
 * SuperAdmin이 수동으로 대시보드 통계를 즉시 갱신할 수 있는 onCall 함수.
 * 배포 직후 초기 시딩 또는 대량 작업 후 즉시 반영에 사용.
 */
export const refreshDashboardStats = onCall(
    { region: "asia-northeast3", timeoutSeconds: 300, memory: "512MiB" },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }

        const db = getFirestore();
        const userDoc = await db.collection("users").doc(request.auth.uid).get();
        const userData = userDoc.data();
        if (!userData || userData.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "superAdmin 권한이 필요합니다.");
        }

        // ── 연타/중복 재집계 방지: 최근 REFRESH_COOLDOWN_SEC 내 갱신되었으면 재계산 생략 ──
        // 캐시 문서의 lastUpdatedAt(ISO) 1건 read로 수만 read짜리 풀스캔을 건너뛴다.
        // 캐시가 아예 없으면(초기 시딩) lastUpdatedAt이 없어 그대로 재집계가 수행된다.
        const statsSnap = await db.doc("system/dashboardStats").get();
        const lastUpdatedAt = statsSnap.get("lastUpdatedAt") as string | undefined;
        if (lastUpdatedAt) {
            const elapsedMs = Date.now() - new Date(lastUpdatedAt).getTime();
            const remainingSec = Math.ceil((REFRESH_COOLDOWN_SEC * 1000 - elapsedMs) / 1000);
            // elapsedMs가 NaN(잘못된 값)이거나 음수(시계 스큐로 미래 시각)면 조건이 거짓이 되어
            // 재집계 쪽으로 안전하게 열린다(fail-open).
            if (elapsedMs >= 0 && remainingSec > 0) {
                return { success: true, skipped: true, lastUpdatedAt, retryAfterSec: remainingSec };
            }
        }

        await computeAllDashboardStats();

        return { success: true, skipped: false };
    }
);
