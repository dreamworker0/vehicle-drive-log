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
import { captureError } from "../../core/sentry";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const firestoreAdmin = require("@google-cloud/firestore");

const gzipAsync = promisify(gzip);

/**
 * 백업 전용 버킷 이름.
 *
 * **기본 버킷(`getStorage().bucket()`)을 쓰면 안 된다.** Firestore 관리형 export는
 * 데이터베이스와 **같은 위치의 버킷만** 받는데, 이 프로젝트의 Firestore는 `asia-northeast3`이고
 * Firebase 기본 버킷(`vehicle-drive-log.firebasestorage.app`)은 `us-east1`이다. 그래서
 * 기본 버킷으로 걸면 실행 즉시 이 400이 난다:
 *
 *   Bucket ...firebasestorage.app is in location us-east1.
 *   This database can only operate on buckets spanning location asia or asia-northeast3.
 *
 * 버킷 위치는 생성 후 변경할 수 없으므로 Firestore와 같은 리전에 백업 전용 버킷을 따로 둔다.
 * 이름은 `FIRESTORE_BACKUP_BUCKET`으로 덮어쓸 수 있고, 없으면 `{projectId}-backups`를 쓴다.
 * (같은 배치의 아카이빙·인증서 정리는 위치 제약이 없는 평범한 GCS 조작이라 기본 버킷 그대로 쓴다.)
 */
export function resolveBackupBucket(projectId: string | undefined): string {
    return process.env.FIRESTORE_BACKUP_BUCKET || `${projectId}-backups`;
}

/**
 * 백업 대상 GCS URI를 만든다.
 *
 * 버킷 이름은 **절대 하드코딩하지 않는다**. 예전에는 `${projectId}.appspot.com`을 박아 뒀는데,
 * 2024-10 이후 만들어진 Firebase 프로젝트에는 그 버킷이 아예 없어서, 없는 버킷에 export를 건
 * 결과가 `7 PERMISSION_DENIED: The caller does not have permission`이었다
 * (존재 여부를 노출하지 않으려고 "없음"을 "권한 없음"으로 보고한다).
 */
export function buildBackupUri(bucketName: string, dateStr: string): string {
    return `gs://${bucketName}/backups/firestore/${dateStr}`;
}

/**
 * Step 0: Firestore 전체 백업 (기존 backupFirestore 로직 통합)
 */
async function backupFirestoreData() {
    console.log("[Batch] Starting backupFirestore...");
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const bucketName = resolveBackupBucket(projectId);

    // 버킷 부재를 먼저 확인한다. 이 검사가 없으면 export가 PERMISSION_DENIED로 떨어져
    // "권한 문제"로 오독하게 된다 — 실제로 그 오독 때문에 원인 규명이 늦어졌다.
    const [bucketExists] = await getStorage().bucket(bucketName).exists();
    if (!bucketExists) {
        throw new Error(
            `백업 버킷 gs://${bucketName} 이(가) 없다. Firestore와 같은 리전(asia-northeast3)에 ` +
            `생성하거나 FIRESTORE_BACKUP_BUCKET 환경변수로 다른 이름을 지정할 것. ` +
            `(기본 버킷은 us-east1이라 Firestore export 대상이 될 수 없다 — OPERATIONS.md §4.1)`
        );
    }

    const outputUri = buildBackupUri(bucketName, getKSTDateString(new Date()));

    const client = new firestoreAdmin.v1.FirestoreAdminClient();
    const databaseName = client.databasePath(projectId, "(default)");

    try {
        const [response] = await client.exportDocuments({
            name: databaseName,
            outputUriPrefix: outputUri,
            collectionIds: [],
        });

        console.log(`Firestore backup started: ${outputUri}`);
        console.log(`Operation: ${response.name}`);
    } catch (e: unknown) {
        // 대상 URI를 에러 메시지에 실어야 Sentry만 보고도 버킷 오지정·위치 불일치·IAM 누락을 구분할 수 있다.
        // (권한 문제라면 export 실행 계정 service-{projectNumber}@gcp-sa-firestore.iam.gserviceaccount.com에
        //  버킷 쓰기 권한이 필요하다. troubleshoot-deployment 스킬 §2.6 참고)
        throw new Error(`Firestore export 실패 (outputUriPrefix=${outputUri}): ${(e as Error).message}`, { cause: e });
    }
}

async function purgeOrgs(db: FirebaseFirestore.Firestore) {
    console.log("[Batch] Starting autoPurgeOrgs...");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // orderBy를 쓰지 않으므로 Firestore가 부등호 필드 기준 **오름차순**을 암묵 적용한다.
    // 화면(삭제된 기관 목록)이 쓰는 status+deletedAt DESC 인덱스로는 이 쿼리가 커버되지 않아
    // firestore.indexes.json에 ASC 조합을 별도로 둔다. 지우면 매일 밤 FAILED_PRECONDITION.
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

/**
 * 배치 스텝 하나를 실행한다. 실패해도 다음 스텝으로 넘어가되, **조용히 넘어가지는 않는다.**
 *
 * 이전에는 각 스텝의 catch가 console.error만 남겼다. 그러면 어디로도 알림이 가지 않아,
 * 특히 Firestore 백업 실패가 "매일 눈으로 확인"(OPERATIONS.md)에만 의존하게 된다 —
 * 백업은 실패한 사실 자체를 놓치면 복구 시점에야 알게 되는 항목이다.
 * captureError로 승격해 Sentry·Discord로 즉시 드러나게 한다.
 *
 * 스텝 단위로만 승격하는 것이 요점이다. 기관별 루프 내부(purgeOrgs 등)의 개별 실패까지
 * 올리면 한 번의 배치가 알림 수십 건을 쏟아낸다 — 그쪽은 console.error로 남긴다.
 */
async function runStep(failed: string[], name: string, fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn();
    } catch (e: unknown) {
        console.error(`Error in ${name}:`, (e as Error).message);
        captureError(e, { context: "dailyNightlyBatch", step: name });
        failed.push(name);
    }
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

        const failed: string[] = [];

        // Step 0: 월간 집계 통계 캐싱 (기존 dailyAggregation 통합, 02:00 실행 전제)
        await runStep(failed, "dailyAggregation", () => runDailyAggregation());
        // Step 0.5: superAdmin 대시보드 통계 캐시 재집계 — 매일 아침 수동 갱신 버튼 없이 최신 상태 유지
        await runStep(failed, "computeAllDashboardStats", () => computeAllDashboardStats());
        // Step 1: Firestore 백업 (기존 backupFirestore 통합)
        await runStep(failed, "backupFirestore", () => backupFirestoreData());
        // Step 2: 기관 퍼지
        await runStep(failed, "purgeOrgs", () => purgeOrgs(db));
        // Step 3: 인증서 이미지 정리
        await runStep(failed, "cleanupImages", () => cleanupImages(db, bucket));
        // Step 4: 운행 기록 아카이빙
        await runStep(failed, "archiveLogs", () => archiveLogs(db, bucket));
        // Step 5: 차량 보험 만료 임박 알림
        await runStep(failed, "checkInsuranceExpiry", () => checkInsuranceExpiry(db));

        if (failed.length > 0) {
            console.error(`[Batch] dailyNightlyBatch completed with ${failed.length} failed step(s): ${failed.join(", ")}`);
        } else {
            console.log("[Batch] dailyNightlyBatch completed.");
        }
    }
);

