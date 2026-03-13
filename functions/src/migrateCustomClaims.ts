/**
 * migrateCustomClaims — 기존 사용자 전체에 Custom Claims를 일괄 설정하는 1회성 함수
 *
 * 시크릿 헤더(x-migrate-key)로 보호. 배포 후 curl로 호출:
 *   curl -H "x-migrate-key: run-claims-migration" \
 *     https://asia-northeast3-vehicle-drive-log.cloudfunctions.net/migrateCustomClaims
 *
 * 완료 후 이 함수는 삭제합니다.
 */
import { onRequest } from "firebase-functions/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const MIGRATE_KEY = "run-claims-migration-2026";

export const migrateCustomClaims = onRequest(
    {
        region: "asia-northeast3",
        timeoutSeconds: 300,
    },
    async (req, res) => {
        // 간단한 시크릿 키 검증 (1회성 사용)
        if (req.headers["x-migrate-key"] !== MIGRATE_KEY) {
            res.status(403).json({ error: "Invalid migration key" });
            return;
        }

        // 마이그레이션 실행
        const db = getFirestore();
        const usersSnap = await db.collection("users").get();

        let success = 0;
        let skipped = 0;
        let failed = 0;
        const results: string[] = [];

        for (const userDoc of usersSnap.docs) {
            const uid = userDoc.id;
            const data = userDoc.data();
            const claims = {
                role: data.role || "employee",
                orgId: data.organizationId || null,
            };

            try {
                await getAuth().setCustomUserClaims(uid, claims);
                results.push(
                    `✅ ${uid} → role=${claims.role}, orgId=${claims.orgId}`
                );
                success++;
            } catch (err: unknown) {
                const authErr = err as { code?: string };
                if (authErr.code === "auth/user-not-found") {
                    results.push(`⏭ ${uid} — Auth 계정 없음 (스킵)`);
                    skipped++;
                } else {
                    results.push(
                        `❌ ${uid} — 실패: ${(err as Error).message}`
                    );
                    failed++;
                }
            }
        }

        res.json({
            total: usersSnap.size,
            success,
            skipped,
            failed,
            results,
        });
    }
);
