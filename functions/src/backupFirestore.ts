/**
 * backupFirestore — 매일 새벽 3시(KST) Firestore 자동 백업
 */
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const firestoreAdmin = require("@google-cloud/firestore");

export const backupFirestore = onSchedule(
    {
        schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
        const bucket = `gs://${projectId}.appspot.com/backups/firestore`;

        const now = new Date();
        const dateStr = now.toISOString().split("T")[0];
        const outputUri = `${bucket}/${dateStr}`;

        try {
            const client = new firestoreAdmin.v1.FirestoreAdminClient();
            const databaseName = client.databasePath(projectId, "(default)");

            const [response] = await client.exportDocuments({
                name: databaseName,
                outputUriPrefix: outputUri,
                collectionIds: [],
            });

            console.log(`Firestore backup started: ${outputUri}`);
            console.log(`Operation: ${response.name}`);
        } catch (err: unknown) {
            console.error("Firestore backup failed:", (err as Error).message);
        }
    }
);
