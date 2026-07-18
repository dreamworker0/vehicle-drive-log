/**
 * dailyNightlyBatch — 매일 02:00(KST) 통합 야간 배치 작업
 *
 * 기존 개별 스케줄러들을 통합하여 인프라 비용 절감:
 * 0. dailyAggregation: 전체 기관 월간 집계 통계 캐싱 (02:00 실행 전제)
 * 0.5. computeAllDashboardStats: superAdmin 대시보드 통계 캐시 재집계
 * 1. backupFirestore: Firestore 전체 백업 (GCS)
 * 2. autoPurgeOrgs: soft-deleted 기관 30일 후 영구 삭제
 * 3. cleanupCertificateImages: 승인 후 30일 경과 기관 인증서 스토리지 삭제
 * 4. archiveDriveLogs: 3년 이상 된 운행 기록을 GCS 아카이빙 후 삭제
 * 5. checkInsuranceExpiry: 차량 보험 만료 15일 이내 시 기관 관리자에게 알림 + 푸시
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { log } from "../../utils/helpers";
import { getKSTDateString } from "../../utils/kstDate";
import { runDailyAggregation } from "./dailyAggregation";
import { computeAllDashboardStats } from "../../services/statistics/computeDashboardStats";
import { createInAppNotification, sendPushToUser } from "../../services/alimtalk/sendNotification";
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

async function cleanupImages(db: FirebaseFirestore.Firestore, bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>) {
    console.log("[Batch] Starting cleanupCertificateImages...");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 승인 기관뿐 아니라 반려 기관의 증빙 이미지도 30일 후 정리 (영구 보존 방지)
    const [approvedSnap, rejectedSnap] = await Promise.all([
        db.collection("organizations")
            .where("status", "==", "approved")
            .where("approvedAt", "<=", thirtyDaysAgo)
            .get(),
        db.collection("organizations")
            .where("status", "==", "rejected")
            .where("rejectedAt", "<=", thirtyDaysAgo)
            .get(),
    ]);
    const targetDocs = [...approvedSnap.docs, ...rejectedSnap.docs];

    if (targetDocs.length === 0) {
        console.log("No certificate images to clean up.");
        return;
    }

    let totalCleaned = 0;
    for (const orgDoc of targetDocs) {
        const orgId = orgDoc.id;
        const data = orgDoc.data();
        // 신규 문서는 경로(uniqueNumberImagePath), 레거시 문서는 토큰 URL(uniqueNumberImageUrl). (2026-07-18 P0-3)
        const imagePath = (data.uniqueNumberImagePath as string) || "";
        const imageUrl = (data.uniqueNumberImageUrl as string) || "";

        if (!imagePath && !imageUrl) continue;

        const orgName = (data.name as string) || orgId;

        try {
            // 저장된 경로가 있으면 그것만 삭제한다. 경로 미상(레거시)이면 허용 확장자를 모두 시도한다.
            const candidatePaths = imagePath
                ? [imagePath]
                : ["jpg", "png", "webp", "pdf"].map((ext) => `organizations/${orgId}/uniqueNumberImage.${ext}`);
            for (const filePath of candidatePaths) {
                const file = bucket.file(filePath);
                const [exists] = await file.exists();
                if (exists) {
                    await file.delete();
                    console.log(`Deleted: ${filePath}`);
                }
            }

            await orgDoc.ref.update({ uniqueNumberImageUrl: "", uniqueNumberImagePath: "" });
            totalCleaned++;
            console.log(`Cleaned certificate for "${orgName}" (${orgId})`);
        } catch (err: unknown) {
            console.error(`Failed to clean certificate for "${orgName}" (${orgId}):`, (err as Error).message);
        }
    }
    console.log(`Certificate cleanup complete: ${totalCleaned} images deleted.`);
}

export async function archiveLogs(db: FirebaseFirestore.Firestore, bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>) {
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

/** 보험 만료일(YYYY-MM-DD)까지 남은 일수. KST 오늘 자정 기준, UTC 자정 파싱으로 TZ drift 방지 */
function insuranceDaysLeft(expiry: string): number {
    const today = Date.parse(`${getKSTDateString()}T00:00:00Z`);
    const target = Date.parse(`${expiry}T00:00:00Z`);
    return Math.round((target - today) / 86400000);
}

/**
 * Step 5: 차량 보험 만료 임박(0~15일) 시 해당 기관 관리자(admin)에게 알림 + 푸시.
 * 멱등성: 이미 같은 만료일로 알림을 보냈으면(insuranceExpiryNotifiedFor) 스킵 → 15일간 중복 발송 방지.
 *         만료일을 갱신해 값이 바뀌면 다시 알림된다.
 */
export async function checkInsuranceExpiry(db: FirebaseFirestore.Firestore) {
    console.log("[Batch] Starting checkInsuranceExpiry...");
    const vehiclesSnap = await db.collection("vehicles").get();
    if (vehiclesSnap.empty) {
        console.log("No vehicles to check.");
        return;
    }

    interface Target {
        ref: FirebaseFirestore.DocumentReference;
        orgId: string;
        name: string;
        expiry: string;
        days: number;
    }
    const targets: Target[] = [];
    for (const doc of vehiclesSnap.docs) {
        const v = doc.data();
        if (v.retired?.isRetired === true) continue;
        const expiry: string | undefined = v.insurance?.expiryDate;
        const orgId: string | undefined = v.organizationId;
        if (!expiry || !orgId) continue;
        const days = insuranceDaysLeft(expiry);
        if (days < 0 || days > 15) continue;
        if (v.insuranceExpiryNotifiedFor === expiry) continue;
        targets.push({ ref: doc.ref, orgId, name: v.displayName || v.name || "차량", expiry, days });
    }

    if (targets.length === 0) {
        console.log("No insurance expiry notifications needed.");
        return;
    }

    // 기관별 admin 목록 1회 조회 후 캐시 (단일 등식 쿼리 → 복합 인덱스 불필요)
    const adminCache = new Map<string, string[]>();
    async function getAdmins(orgId: string): Promise<string[]> {
        const cached = adminCache.get(orgId);
        if (cached) return cached;
        const usersSnap = await db.collection("users").where("organizationId", "==", orgId).get();
        const admins = usersSnap.docs.filter((u) => u.data().role === "admin").map((u) => u.id);
        adminCache.set(orgId, admins);
        return admins;
    }

    let notified = 0;
    for (const t of targets) {
        try {
            const admins = await getAdmins(t.orgId);
            if (admins.length === 0) continue;
            const title = "🛡️ 차량 보험 만료 예정";
            const message = t.days === 0
                ? `${t.name} 차량 보험이 오늘(${t.expiry}) 만료됩니다.`
                : `${t.name} 차량 보험이 ${t.days}일 뒤(${t.expiry}) 만료됩니다.`;
            for (const uid of admins) {
                await createInAppNotification(uid, "insurance_expiry_warning", title, message, t.orgId);
                await sendPushToUser(uid, { title, body: message });
            }
            await t.ref.update({ insuranceExpiryNotifiedFor: t.expiry });
            notified++;
        } catch (err: unknown) {
            console.error(`Insurance expiry notify failed for vehicle ${t.ref.id}:`, (err as Error).message);
        }
    }
    console.log(`Insurance expiry check complete: ${notified} vehicles notified.`);
}

export const dailyNightlyBatch = onSchedule(
    {
        schedule: "0 2 * * *", // KST 02:00 (집계 + 백업 + 야간 배치 통합)
        timeZone: "Asia/Seoul",
        retryCount: 1,
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();

        // Step 0: 월간 집계 통계 캐싱 (기존 dailyAggregation 통합, 02:00 실행 전제)
        try {
            await runDailyAggregation();
        } catch (e: unknown) {
            console.error("Error in dailyAggregation:", (e as Error).message);
        }

        // Step 0.5: superAdmin 대시보드 통계 캐시 재집계 — 매일 아침 수동 갱신 버튼 없이 최신 상태 유지
        try {
            await computeAllDashboardStats();
        } catch (e: unknown) {
            console.error("Error in computeAllDashboardStats:", (e as Error).message);
        }

        // Step 1: Firestore 백업 (기존 backupFirestore 통합)
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

        // Step 4: 차량 보험 만료 임박 알림
        try {
            await checkInsuranceExpiry(db);
        } catch (e: unknown) {
            console.error("Error in checkInsuranceExpiry:", (e as Error).message);
        }

        console.log("[Batch] dailyNightlyBatch completed.");
    }
);

