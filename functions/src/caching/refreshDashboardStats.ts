import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { computeAllDashboardStats } from "./computeDashboardStats";

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

        await computeAllDashboardStats();

        return { success: true };
    }
);
