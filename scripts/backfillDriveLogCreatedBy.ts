/**
 * 백필 스크립트: 기존 운행일지에 createdByUid 소급 적용
 *
 * 배경: "대표 운전자 선택" 기능(2026-07-17)으로 driverUid가 작성자에서 대표 운전자로 분리되며,
 *       Firestore 규칙의 소유자 판정 기준이 createdByUid로 이관되었다.
 *       규칙에 구 데이터 폴백(createdByUid 부재 시 driverUid==auth.uid)이 있어 필수는 아니지만,
 *       기존 문서에 createdByUid = driverUid를 채워두면 판정이 명확해진다.
 *
 * 사용법:
 *   npx tsx scripts/backfillDriveLogCreatedBy.ts            # 실제 실행
 *   npx tsx scripts/backfillDriveLogCreatedBy.ts --dry-run  # 변경 없이 대상만 집계
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 */
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as path from "path";
import * as fs from "fs";

const isDryRun = process.argv.includes("--dry-run");

const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json");

let app;
try {
    const serviceAccountStr = fs.readFileSync(keyPath, "utf-8");
    const serviceAccount = JSON.parse(serviceAccountStr) as ServiceAccount;
    app = initializeApp({ credential: cert(serviceAccount) });
} catch {
    app = initializeApp();
}

const db = getFirestore(app);

async function backfill() {
    console.log(`=== 백필 시작: driveLogs.createdByUid ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    const snap = await db.collection("driveLogs").get();

    let updated = 0;
    let skipped = 0;
    let noDriver = 0;

    // Firestore 배치 상한(500)을 고려해 청크로 커밋
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
        const data = doc.data();

        // 이미 createdByUid가 있으면 스킵
        if (data.createdByUid) {
            skipped++;
            continue;
        }
        // driverUid가 없으면 채울 근거가 없음
        if (!data.driverUid) {
            noDriver++;
            continue;
        }

        if (isDryRun) {
            updated++;
            continue;
        }

        batch.update(doc.ref, { createdByUid: data.driverUid });
        batchCount++;
        updated++;

        if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (!isDryRun && batchCount > 0) {
        await batch.commit();
    }

    console.log(`총 운행일지: ${snap.size}개`);
    console.log(`  ${isDryRun ? "백필 예정" : "업데이트"}: ${updated}개`);
    console.log(`  이미 createdByUid 있음(스킵): ${skipped}개`);
    console.log(`  driverUid 없음(스킵): ${noDriver}개`);
    console.log(`\n=== 백필 완료 ===`);
}

backfill().catch((err) => {
    console.error(err);
    process.exit(1);
});
