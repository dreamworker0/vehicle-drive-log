/**
 * 기존 사용자 전체에 Custom Claims를 일괄 설정하는 마이그레이션 스크립트
 *
 * 사용법:
 *   cd functions && npx tsx ../scripts/migrateCustomClaims.ts
 *
 * 이 스크립트는 setCustomClaims Cloud Function 배포 후 1회 실행합니다.
 * 이후 새 사용자는 Firestore 트리거가 자동 처리합니다.
 */
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Firebase Admin 초기화 (서비스 계정 키 파일 또는 기본 인증)
const saPath = resolve(__dirname, "../functions/serviceAccountKey.json");
if (existsSync(saPath)) {
    const sa = JSON.parse(readFileSync(saPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(sa) });
} else {
    // GOOGLE_APPLICATION_CREDENTIALS 환경변수 또는 gcloud 기본 인증 사용
    initializeApp();
}

const db = getFirestore();
const auth = getAuth();

async function migrate() {
    console.log("🔄 Custom Claims 마이그레이션 시작...\n");

    const usersSnap = await db.collection("users").get();
    console.log(`총 ${usersSnap.size}명의 사용자 발견\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const data = userDoc.data();
        const claims = {
            role: data.role || "employee",
            orgId: data.organizationId || null,
        };

        try {
            await auth.setCustomUserClaims(uid, claims);
            console.log(`  ✅ ${uid} → role=${claims.role}, orgId=${claims.orgId}`);
            success++;
        } catch (err: unknown) {
            const authErr = err as { code?: string };
            if (authErr.code === "auth/user-not-found") {
                console.log(`  ⏭ ${uid} — Auth 계정 없음 (스킵)`);
                skipped++;
            } else {
                console.error(`  ❌ ${uid} — 실패:`, (err as Error).message);
                failed++;
            }
        }
    }

    console.log(`\n📊 결과: 성공=${success}, 스킵=${skipped}, 실패=${failed}`);
    console.log("✅ 마이그레이션 완료!");
}

migrate().catch(console.error);
