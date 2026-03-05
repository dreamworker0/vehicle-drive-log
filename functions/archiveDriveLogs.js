const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");

/**
 * 매일 04:30(KST) 3년 이상 경과된 운행 기록을 GCS로 아카이빙 후 Firestore에서 삭제
 */
exports.archiveDriveLogs = onSchedule(
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
            console.log("No drive logs older than 3 years. Skipping.");
            return;
        }

        const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // GCS에 JSON으로 저장
        const dateStr = new Date().toISOString().split("T")[0];
        const filePath = `archives/driveLogs/${dateStr}_${logs.length}records.json`;
        const file = bucket.file(filePath);

        await file.save(JSON.stringify(logs, null, 2), {
            contentType: "application/json",
            metadata: {
                archivedAt: new Date().toISOString(),
                recordCount: String(logs.length),
            },
        });

        // Firestore에서 삭제 (batch 500건 제한)
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        console.log(
            `Archived ${logs.length} drive logs to gs://${bucket.name}/${filePath}`
        );
    }
);
