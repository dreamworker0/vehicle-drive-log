/**
 * archiveDriveLogs — 매일 04:30(KST) 3년 이상 된 운행 기록을 GCS 아카이빙 후 Firestore에서 삭제
 *
 * 아카이브 파일은 gzip 압축 JSON으로 저장되어 GCS 비용을 절감한다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { log } from "./helpers";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

export const archiveDriveLogs = onSchedule(
    {
        schedule: "30 19 * * *", // UTC 19:30 = KST 04:30
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();

        const threeYearsAgo = new Date();
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

        const snap = await db
            .collection("driveLogs")
            .where("timestamp", "<", threeYearsAgo)
            .limit(500)
            .get();

        if (snap.empty) {
            log("INFO", "archiveDriveLogs", "3년 이상 된 운행 기록 없음. 스킵.");
            return;
        }

        const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // gzip 압축 후 GCS 저장
        const dateStr = new Date().toISOString().split("T")[0];
        const filePath = `archives/driveLogs/${dateStr}_${logs.length}records.json.gz`;
        const file = bucket.file(filePath);

        const jsonData = JSON.stringify(logs, null, 2);
        const compressed = await gzipAsync(Buffer.from(jsonData));

        await file.save(compressed, {
            contentType: "application/gzip",
            metadata: {
                archivedAt: new Date().toISOString(),
                recordCount: String(logs.length),
                originalSize: String(jsonData.length),
                compressedSize: String(compressed.length),
            },
        });

        // Firestore에서 삭제
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        log("INFO", "archiveDriveLogs", `${logs.length}건 아카이빙 완료`, {
            filePath: `gs://${bucket.name}/${filePath}`,
            originalSize: jsonData.length,
            compressedSize: compressed.length,
            compressionRatio: `${Math.round((1 - compressed.length / jsonData.length) * 100)}%`,
        });
    }
);
