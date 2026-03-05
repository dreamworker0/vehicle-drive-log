/**
 * cleanupDuplicateLogs — 운행일지 중복 데이터 탐지 및 정리
 * onCall: 관리자가 호출하여 기관의 중복 운행일지를 탐지/삭제
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");

exports.cleanupDuplicateLogs = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { organizationId, dryRun = true } = request.data;

        if (!organizationId) {
            throw new HttpsError("invalid-argument", "organizationId가 필요합니다.");
        }

        // 권한 확인: admin 또는 superAdmin만 허용
        const db = getFirestore();
        const userDoc = await db.collection("users").doc(request.auth.uid).get();
        const userData = userDoc.data();

        if (!userData || !["admin", "superAdmin"].includes(userData.role)) {
            throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
        }

        try {
            // 해당 기관의 전체 운행일지 조회
            const logsSnap = await db.collection("driveLogs")
                .where("organizationId", "==", organizationId)
                .orderBy("createdAt", "asc")
                .get();

            console.log(`[cleanupDuplicateLogs] 기관=${organizationId}, 총 ${logsSnap.size}건 조회`);

            // 중복 그룹 탐색: 같은 날짜+차량+운전자+startKm+endKm
            const logMap = new Map();

            logsSnap.forEach(doc => {
                const data = doc.data();
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : null;
                const dateStr = ts
                    ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`
                    : "unknown";

                const key = `${dateStr}|${data.vehicleId}|${data.driverUid}|${data.startKm}|${data.endKm}`;

                if (!logMap.has(key)) {
                    logMap.set(key, []);
                }
                logMap.get(key).push({ id: doc.id, createdAt: data.createdAt, dateStr });
            });

            // 중복 그룹에서 삭제 대상 수집
            const duplicateGroups = [];
            const deleteTargets = [];

            for (const [key, group] of logMap) {
                if (group.length > 1) {
                    // 첫 번째(가장 먼저 생성된) 문서만 남기고 나머지 삭제
                    const toDelete = group.slice(1).map(g => g.id);
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

            // dryRun이 아닌 경우 실제 삭제
            if (!dryRun && deleteTargets.length > 0) {
                // Firestore batch는 최대 500건씩
                const batchSize = 500;
                for (let i = 0; i < deleteTargets.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = deleteTargets.slice(i, i + batchSize);
                    chunk.forEach(id => {
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
                details: duplicateGroups.slice(0, 50), // 최대 50개 그룹 상세 반환
            };
        } catch (err) {
            console.error("cleanupDuplicateLogs 실패:", err.message);
            throw new HttpsError("internal", err.message);
        }
    }
);
