import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * 운행일지가 생성, 수정, 삭제될 때마다 기관(Organization) 레벨의 요약 통계(Aggregated Stats)를 자동으로 계산하여 캐싱합니다.
 * 이 캐싱 데이터를 프론트엔드 대시보드 등에서 조회하면, 수천 건의 로그 조회를 1건으로 줄일 수 있습니다.
 */
export const updateAggregatedStats = onDocumentWritten(
    {
        document: "driveLogs/{logId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const change = event.data;
        if (!change) return;

        const beforeData = change.before.data();
        const afterData = change.after.data();

        // 기관 ID 판별 (생성, 수정은 afterData에, 삭제는 beforeData에 있음)
        const organizationId = afterData?.organizationId || beforeData?.organizationId;
        if (!organizationId) {
            console.warn(`[updateAggregatedStats] organizationId 없음. (logId: ${event.params.logId})`);
            return;
        }

        const db = getFirestore();
        const orgStatsRef = db.collection("organizations").doc(organizationId).collection("stats").doc("aggregate");

        let logCountChange = 0;
        let distanceChange = 0;

        // 1. 문서 생성 (Insert)
        if (!change.before.exists && change.after.exists) {
            logCountChange = 1;
            const dist = (afterData?.endKm || 0) - (afterData?.startKm || 0);
            if (dist > 0) distanceChange += dist;
        }
        // 2. 문서 삭제 (Delete)
        else if (change.before.exists && !change.after.exists) {
            logCountChange = -1;
            const dist = (beforeData?.endKm || 0) - (beforeData?.startKm || 0);
            if (dist > 0) distanceChange -= dist;
        }
        // 3. 문서 수정 (Update)
        else if (change.before.exists && change.after.exists) {
            const beforeDist = (beforeData?.endKm || 0) - (beforeData?.startKm || 0);
            const afterDist = (afterData?.endKm || 0) - (afterData?.startKm || 0);
            // 만약 거리가 변경되었다면 차이만큼만 증감
            if (beforeDist !== afterDist) {
                distanceChange = (afterDist > 0 ? afterDist : 0) - (beforeDist > 0 ? beforeDist : 0);
            }
        }

        // 아무 변경이 없으면 무시
        if (logCountChange === 0 && distanceChange === 0) return;

        try {
            await orgStatsRef.set(
                {
                    totalLogs: FieldValue.increment(logCountChange),
                    totalDistance: FieldValue.increment(distanceChange),
                    lastUpdatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );

            // TODO : 월별 통계(YYYY-MM) 추가 확장 가능
        } catch (error) {
            console.error(`[updateAggregatedStats] 통계 업데이트 실패 (${organizationId}):`, error);
        }
    }
);
