import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * 운행일지가 생성, 수정, 삭제될 때마다 기관(Organization) 레벨의 요약 통계(Aggregated Stats)를 자동으로 계산하여 캐싱합니다.
 * 이 캐싱 데이터를 프론트엔드 대시보드 등에서 조회하면, 수천 건의 로그 조회를 1건으로 줄일 수 있습니다.
 *
 * 저장 경로: organizations/{orgId}/stats/aggregate
 * 저장 구조:
 *   - count: 전체 운행 건수
 *   - totalDistance: 전체 누적 거리
 *   - monthlyStats: { "YYYY-MM": { count, totalDistance } }
 *   - lastUpdatedAt: 마지막 업데이트 시각
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

        /** 타임스탬프에서 월 키(YYYY-MM) 추출 */
        const getMonthKey = (data: FirebaseFirestore.DocumentData | undefined): string | null => {
            if (!data) return null;
            const ts = data.timestamp;
            if (ts && typeof ts.toDate === "function") {
                const d = ts.toDate() as Date;
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            }
            if (ts instanceof Date) {
                return `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`;
            }
            return null;
        };

        /** 운행 거리 계산 (endKm - startKm, 음수 방지) */
        const calcDistance = (data: FirebaseFirestore.DocumentData | undefined): number => {
            if (!data) return 0;
            const dist = (data.endKm || 0) - (data.startKm || 0);
            return dist > 0 ? dist : 0;
        };

        const isCreate = !change.before.exists && change.after.exists;
        const isDelete = change.before.exists && !change.after.exists;

        try {
            // === 1. 문서 생성 ===
            if (isCreate) {
                const dist = calcDistance(afterData);
                const monthKey = getMonthKey(afterData);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const payload: Record<string, any> = {
                    count: FieldValue.increment(1),
                    totalDistance: FieldValue.increment(dist),
                    lastUpdatedAt: FieldValue.serverTimestamp(),
                };

                if (monthKey) {
                    payload.monthlyStats = {
                        [monthKey]: {
                            count: FieldValue.increment(1),
                            totalDistance: FieldValue.increment(dist),
                        },
                    };
                }

                await orgStatsRef.set(payload, { merge: true });
                return;
            }

            // === 2. 문서 삭제 ===
            if (isDelete) {
                const dist = calcDistance(beforeData);
                const monthKey = getMonthKey(beforeData);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const payload: Record<string, any> = {
                    count: FieldValue.increment(-1),
                    totalDistance: FieldValue.increment(-dist),
                    lastUpdatedAt: FieldValue.serverTimestamp(),
                };

                if (monthKey) {
                    payload.monthlyStats = {
                        [monthKey]: {
                            count: FieldValue.increment(-1),
                            totalDistance: FieldValue.increment(-dist),
                        },
                    };
                }

                await orgStatsRef.set(payload, { merge: true });
                return;
            }

            // === 3. 문서 수정 ===
            const beforeDist = calcDistance(beforeData);
            const afterDist = calcDistance(afterData);
            const distanceChange = afterDist - beforeDist;
            const beforeMonth = getMonthKey(beforeData);
            const afterMonth = getMonthKey(afterData);
            const monthChanged = beforeMonth && afterMonth && beforeMonth !== afterMonth;

            // 거리 변경도 없고 월 이동도 없으면 무시
            if (distanceChange === 0 && !monthChanged) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload: Record<string, any> = {
                totalDistance: FieldValue.increment(distanceChange),
                lastUpdatedAt: FieldValue.serverTimestamp(),
            };

            if (monthChanged) {
                // 월이 바뀐 수정: 이전 월에서 빼고, 새 월에 넣기
                payload.count = FieldValue.increment(0); // 전체 카운트는 변동 없음
                payload.monthlyStats = {
                    [beforeMonth!]: {
                        count: FieldValue.increment(-1),
                        totalDistance: FieldValue.increment(-beforeDist),
                    },
                    [afterMonth!]: {
                        count: FieldValue.increment(1),
                        totalDistance: FieldValue.increment(afterDist),
                    },
                };
            } else if (distanceChange !== 0 && afterMonth) {
                // 같은 월 내 거리만 변경
                payload.monthlyStats = {
                    [afterMonth]: {
                        totalDistance: FieldValue.increment(distanceChange),
                    },
                };
            }

            await orgStatsRef.set(payload, { merge: true });
        } catch (error) {
            console.error(`[updateAggregatedStats] 통계 업데이트 실패 (${organizationId}):`, error);
        }
    }
);
