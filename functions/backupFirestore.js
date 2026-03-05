const { getFirestore } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

/**
 * 매일 새벽 3시(KST) Firestore 자동 백업
 * Cloud Storage에 exportDocuments로 저장
 */
exports.backupFirestore = onSchedule(
    {
        schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        const firestore = getFirestore();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
        const bucket = `gs://${projectId}.appspot.com/backups/firestore`;

        const now = new Date();
        const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
        const outputUri = `${bucket}/${dateStr}`;

        try {
            const client = new (require("@google-cloud/firestore").v1.FirestoreAdminClient)();
            const databaseName = client.databasePath(projectId, "(default)");

            const [response] = await client.exportDocuments({
                name: databaseName,
                outputUriPrefix: outputUri,
                collectionIds: [], // 빈 배열 = 모든 컬렉션
            });

            console.log(`Firestore backup started: ${outputUri}`);
            console.log(`Operation: ${response.name}`);
        } catch (err) {
            console.error("Firestore backup failed:", err.message);
        }
    }
);
