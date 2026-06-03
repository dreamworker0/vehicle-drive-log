import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getKSTMonthKey } from "../utils/kstDate";

/**
 * 모든 기관(또는 특정 기관)의 운행일지 집계 통계를 처음부터 재계산합니다.
 * 일회성 마이그레이션 / 보정 용도. 관리자(superAdmin)만 호출 가능.
 *
 * 호출 예시 (브라우저 콘솔):
 *   const fn = firebase.functions().httpsCallable('recalculateAggregatedStats');
 *   await fn();                       // 전체 기관
 *   await fn({ organizationId: 'xxx' }); // 특정 기관만
 */
export const recalculateAggregatedStats = onCall(
    { region: "asia-northeast3", timeoutSeconds: 300 },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }

        const db = getFirestore();

        // superAdmin 확인
        const userDoc = await db.collection("users").doc(request.auth.uid).get();
        const userData = userDoc.data();
        if (!userData || userData.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "superAdmin 권한이 필요합니다.");
        }

        const targetOrgId = request.data?.organizationId as string | undefined;

        // 대상 기관 목록 결정
        let orgIds: string[] = [];
        if (targetOrgId) {
            orgIds = [targetOrgId];
        } else {
            const orgSnap = await db.collection("organizations").get();
            orgIds = orgSnap.docs.map((d) => d.id);
        }

        console.log(`[recalculateAggregatedStats] 대상 기관 수: ${orgIds.length}`);

        let processedCount = 0;

        for (const orgId of orgIds) {
            // 해당 기관의 모든 운행일지 조회
            const logsSnap = await db
                .collection("driveLogs")
                .where("organizationId", "==", orgId)
                .get();

            let totalCount = 0;
            let totalDistance = 0;
            const monthlyStats: Record<string, { count: number; totalDistance: number }> = {};

            for (const doc of logsSnap.docs) {
                const data = doc.data();
                const dist = Math.max(0, (data.endKm || 0) - (data.startKm || 0));

                totalCount++;
                totalDistance += dist;

                // 월 키 추출
                let monthKey: string | null = null;
                const ts = data.timestamp;
                if (ts && typeof ts.toDate === "function") {
                    monthKey = getKSTMonthKey(ts.toDate());
                }

                if (monthKey) {
                    if (!monthlyStats[monthKey]) {
                        monthlyStats[monthKey] = { count: 0, totalDistance: 0 };
                    }
                    monthlyStats[monthKey].count++;
                    monthlyStats[monthKey].totalDistance += dist;
                }
            }

            // 통계 문서에 기록
            const statsRef = db.collection("organizations").doc(orgId).collection("stats").doc("aggregate");
            await statsRef.set(
                {
                    count: totalCount,
                    totalDistance,
                    monthlyStats,
                    lastUpdatedAt: new Date().toISOString(),
                    recalculatedAt: new Date().toISOString(),
                },
                { merge: false } // 완전 덮어쓰기 (기존 데이터 정리)
            );

            processedCount++;
            if (processedCount % 10 === 0) {
                console.log(`[recalculateAggregatedStats] 진행: ${processedCount}/${orgIds.length}`);
            }
        }

        console.log(`[recalculateAggregatedStats] 완료: ${processedCount}개 기관 처리됨`);
        return { success: true, processedCount };
    }
);
