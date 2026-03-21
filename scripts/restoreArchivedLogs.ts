/**
 * restoreArchivedLogs — GCS 아카이브에서 Firestore로 운행 기록 복원
 *
 * 사용법:
 *   npx tsx scripts/restoreArchivedLogs.ts <아카이브파일경로>
 *
 * 예시:
 *   npx tsx scripts/restoreArchivedLogs.ts archives/driveLogs/2026-03-21_500records.json.gz
 *
 * 주의:
 *   - Firebase Admin SDK 서비스 계정 키가 GOOGLE_APPLICATION_CREDENTIALS에 설정되어 있어야 함
 *   - 또는 `gcloud auth application-default login`으로 인증되어 있어야 함
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

// Firebase 초기화
initializeApp({ projectId: "vehicle-drive-log" });

const db = getFirestore();
const bucket = getStorage().bucket("vehicle-drive-log.firebasestorage.app");

async function restoreArchive(archivePath: string) {
    console.log(`📦 아카이브 파일 다운로드: ${archivePath}`);

    const file = bucket.file(archivePath);
    const [exists] = await file.exists();

    if (!exists) {
        console.error(`❌ 파일을 찾을 수 없습니다: gs://${bucket.name}/${archivePath}`);
        process.exit(1);
    }

    // 파일 다운로드
    const [content] = await file.download();

    // gzip 압축 해제 (확장자로 판별)
    let jsonStr: string;
    if (archivePath.endsWith(".gz")) {
        const decompressed = await gunzipAsync(content);
        jsonStr = decompressed.toString("utf-8");
    } else {
        jsonStr = content.toString("utf-8");
    }

    const logs = JSON.parse(jsonStr) as Array<Record<string, unknown> & { id: string }>;
    console.log(`📋 복원할 레코드 수: ${logs.length}`);

    // Firestore batch 쓰기 (500건 제한)
    const batchSize = 500;
    let restored = 0;

    for (let i = 0; i < logs.length; i += batchSize) {
        const chunk = logs.slice(i, i + batchSize);
        const batch = db.batch();

        for (const log of chunk) {
            const { id, ...data } = log;
            if (!id) {
                console.warn("⚠️ id가 없는 레코드 스킵:", log);
                continue;
            }
            batch.set(db.collection("driveLogs").doc(id), data);
        }

        await batch.commit();
        restored += chunk.length;
        console.log(`  ✅ ${restored}/${logs.length} 레코드 복원됨`);
    }

    console.log(`\n🎉 복원 완료! 총 ${restored}건`);
}

// CLI 실행
const archivePath = process.argv[2];

if (!archivePath) {
    console.error("사용법: npx tsx scripts/restoreArchivedLogs.ts <아카이브파일경로>");
    console.error("예시:   npx tsx scripts/restoreArchivedLogs.ts archives/driveLogs/2026-03-21_500records.json.gz");
    process.exit(1);
}

restoreArchive(archivePath).catch((err) => {
    console.error("❌ 복원 실패:", err);
    process.exit(1);
});
