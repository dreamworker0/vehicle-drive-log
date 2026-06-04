/**
 * dailyNightlyBatch — 매일 03:00(KST) 통합 야간 배치 작업
 * 
 * 기존 개별 스케줄러들을 통합하여 인프라 비용 절감:
 * 0. backupFirestore: Firestore 전체 백업 (GCS)
 * 1. autoPurgeOrgs: soft-deleted 기관 30일 후 영구 삭제
 * 2. cleanupCertificateImages: 승인 후 30일 경과 기관 인증서 스토리지 삭제
 * 3. archiveDriveLogs: 3년 이상 된 운행 기록을 GCS 아카이빙 후 삭제
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { log } from "./helpers";
import { getKSTDateString } from "./utils/kstDate";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const firestoreAdmin = require("@google-cloud/firestore");

const gzipAsync = promisify(gzip);

/**
 * Step 0: Firestore 전체 백업 (기존 backupFirestore 로직 통합)
 */
async function backupFirestoreData() {
    console.log("[Batch] Starting backupFirestore...");
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const bucket = `gs://${projectId}.appspot.com/backups/firestore`;

    const now = new Date();
    const dateStr = getKSTDateString(now);
    const outputUri = `${bucket}/${dateStr}`;

    const client = new firestoreAdmin.v1.FirestoreAdminClient();
    const databaseName = client.databasePath(projectId, "(default)");

    const [response] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix: outputUri,
        collectionIds: [],
    });

    console.log(`Firestore backup started: ${outputUri}`);
    console.log(`Operation: ${response.name}`);
}

async function purgeOrgs(db: FirebaseFirestore.Firestore) {
    console.log("[Batch] Starting autoPurgeOrgs...");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedOrgsSnap = await db
        .collection("organizations")
        .where("status", "==", "deleted")
        .where("deletedAt", "<=", thirtyDaysAgo)
        .get();

    if (deletedOrgsSnap.empty) {
        console.log("No organizations to purge.");
        return;
    }

    let totalPurged = 0;
    for (const orgDoc of deletedOrgsSnap.docs) {
        const orgId = orgDoc.id;
        const orgName = (orgDoc.data().name as string) || orgId;

        try {
            const usersSnap = await db
                .collection("users")
                .where("organizationId", "==", orgId)
                .get();

            const batch = db.batch();
            usersSnap.docs.forEach((userDoc) => {
                batch.delete(userDoc.ref);
            });
            batch.delete(orgDoc.ref);
            await batch.commit();

            totalPurged++;
            console.log(`Purged org "${orgName}" (${orgId}) with ${usersSnap.size} users`);
        } catch (err: unknown) {
            console.error(`Failed to purge org "${orgName}" (${orgId}):`, (err as Error).message);
        }
    }
    console.log(`Auto-purge complete: ${totalPurged} organizations permanently deleted.`);
}

async function cleanupImages(db: FirebaseFirestore.Firestore, bucket: any) {
    console.log("[Batch] Starting cleanupCertificateImages...");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orgsSnap = await db
        .collection("organizations")
        .where("status", "==", "approved")
        .where("approvedAt", "<=", thirtyDaysAgo)
        .get();

    if (orgsSnap.empty) {
        console.log("No certificate images to clean up.");
        return;
    }

    let totalCleaned = 0;
    for (const orgDoc of orgsSnap.docs) {
        const orgId = orgDoc.id;
        const data = orgDoc.data();
        const imageUrl = data.uniqueNumberImageUrl as string;

        if (!imageUrl) continue;

        const orgName = (data.name as string) || orgId;

        try {
            const extensions = ["jpg", "pdf"];
            for (const ext of extensions) {
                const filePath = `organizations/${orgId}/uniqueNumberImage.${ext}`;
                const file = bucket.file(filePath);
                const [exists] = await file.exists();
                if (exists) {
                    await file.delete();
                    console.log(`Deleted: ${filePath}`);
                }
            }

            await orgDoc.ref.update({ uniqueNumberImageUrl: "" });
            totalCleaned++;
            console.log(`Cleaned certificate for "${orgName}" (${orgId})`);
        } catch (err: unknown) {
            console.error(`Failed to clean certificate for "${orgName}" (${orgId}):`, (err as Error).message);
        }
    }
    console.log(`Certificate cleanup complete: ${totalCleaned} images deleted.`);
}

async function archiveLogs(db: FirebaseFirestore.Firestore, bucket: any) {
    console.log("[Batch] Starting archiveDriveLogs...");
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    const snap = await db
        .collection("driveLogs")
        .where("timestamp", "<", threeYearsAgo)
        .limit(500)
        .get();

    if (snap.empty) {
        log("INFO", "dailyNightlyBatch", "3년 이상 된 운행 기록 없음. 스킵.");
        return;
    }

    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const dateStr = getKSTDateString();
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

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    log("INFO", "dailyNightlyBatch", `${logs.length}건 아카이빙 완료`, {
        filePath: `gs://${bucket.name}/${filePath}`,
        originalSize: jsonData.length,
        compressedSize: compressed.length,
        compressionRatio: `${Math.round((1 - compressed.length / jsonData.length) * 100)}%`,
    });
}

export const dailyNightlyBatch = onSchedule(
    {
        schedule: "0 3 * * *", // KST 03:00 (백업 + 야간 배치 통합)
        timeZone: "Asia/Seoul",
        retryCount: 1,
        memory: "512MiB",
        timeoutSeconds: 300,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();

        // Step 0: Firestore 백업 (기존 backupFirestore 통합)
        try {
            await backupFirestoreData();
        } catch (e: unknown) {
            console.error("Error in backupFirestore:", (e as Error).message);
        }

        // Step 1: 기관 퍼지
        try {
            await purgeOrgs(db);
        } catch (e: unknown) {
            console.error("Error in purgeOrgs:", (e as Error).message);
        }

        // Step 2: 인증서 이미지 정리
        try {
            await cleanupImages(db, bucket);
        } catch (e: unknown) {
            console.error("Error in cleanupImages:", (e as Error).message);
        }

        // Step 3: 운행 기록 아카이빙
        try {
            await archiveLogs(db, bucket);
        } catch (e: unknown) {
            console.error("Error in archiveLogs:", (e as Error).message);
        }

        console.log("[Batch] dailyNightlyBatch completed.");
    }
);

