/**
 * cleanupDuplicateLogs — 운행일지 중복 데이터 탐지 및 정리
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getKSTDateString } from "../../utils/kstDate";

export const cleanupDuplicateLogs = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        enforceAppCheck: false,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { organizationId, dryRun = true } = request.data;

        if (!organizationId) {
            throw new HttpsError("invalid-argument", "organizationId가 필요합니다.");
        }

        // 권한은 Firestore 문서가 아닌 Custom Claims 기준 (firestore.rules·requireSuperAdmin과 동일)
        const callerRole = request.auth.token.role as string;
        if (!["admin", "superAdmin"].includes(callerRole)) {
            throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
        }

        // 교차 테넌트 차단: admin은 자신의 기관만 정리 가능, superAdmin만 타 기관 허용
        if (callerRole !== "superAdmin" && request.auth.token.orgId !== organizationId) {
            throw new HttpsError("permission-denied", "자신의 기관 데이터만 정리할 수 있습니다.");
        }

        const db = getFirestore();

        try {
            const logsSnap = await db.collection("driveLogs")
                .where("organizationId", "==", organizationId)
                .orderBy("createdAt", "asc")
                .get();

            console.log(`[cleanupDuplicateLogs] 기관=${organizationId}, 총 ${logsSnap.size}건 조회`);

            const logMap = new Map<string, Array<{ id: string; createdAt: unknown; dateStr: string }>>();

            logsSnap.forEach((doc) => {
                const data = doc.data();
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : null;
                const dateStr = ts ? getKSTDateString(ts) : "unknown";

                const key = `${dateStr}|${data.vehicleId}|${data.driverUid}|${data.startKm}|${data.endKm}`;

                if (!logMap.has(key)) {
                    logMap.set(key, []);
                }
                logMap.get(key)!.push({ id: doc.id, createdAt: data.createdAt, dateStr });
            });

            const duplicateGroups: Array<{ key: string; count: number; keepId: string; deleteIds: string[] }> = [];
            const deleteTargets: string[] = [];

            for (const [key, group] of logMap) {
                if (group.length > 1) {
                    const toDelete = group.slice(1).map((g) => g.id);
                    duplicateGroups.push({
                        key,
                        count: group.length,
                        keepId: group[0].id,
                        deleteIds: toDelete,
                    });
                    deleteTargets.push(...toDelete);
                }
            }

            console.log(`[cleanupDuplicateLogs] 중복 그룹: ${duplicateGroups.length}개, 삭제 대상: ${deleteTargets.length}건`);

            if (!dryRun && deleteTargets.length > 0) {
                const batchSize = 500;
                for (let i = 0; i < deleteTargets.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = deleteTargets.slice(i, i + batchSize);
                    chunk.forEach((id) => {
                        batch.delete(db.collection("driveLogs").doc(id));
                    });
                    await batch.commit();
                    console.log(`[cleanupDuplicateLogs] 삭제 완료: ${i + chunk.length}/${deleteTargets.length}`);
                }
            }

            return {
                success: true,
                totalLogs: logsSnap.size,
                duplicateGroups: duplicateGroups.length,
                deleteCount: deleteTargets.length,
                dryRun,
                details: duplicateGroups.slice(0, 50),
            };
        } catch (err: unknown) {
            console.error("cleanupDuplicateLogs 실패:", (err as Error).message);
            throw new HttpsError("internal", (err as Error).message);
        }
    }
);
