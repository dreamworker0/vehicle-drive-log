/**
 * dailyNightlyBatch — 매일 02:20(KST) 야간 배치 (백업 + 보험 만료 알림)
 *
 * 1. backupFirestore: Firestore 전체 백업 (GCS)
 * 2. checkInsuranceExpiry: 차량 보험 만료 15일 이내 시 기관 관리자에게 알림 + 푸시
 *
 * ## 이 파일이 담는 것과 담지 않는 것
 * 예전에는 성격이 다른 일곱 스텝을 한 함수에 몰아넣고 1GiB·540초로 돌렸다. 2026-08-28
 * Cloud Run 비용 점검에서 이 함수가 **청구 대상 인스턴스 시간 1위**(2위 그룹의 5배)로 나와
 * 성격별로 셋으로 쪼갰다. 스텝 구현은 이 파일에 그대로 두고 진입점만 나눈다.
 *
 *  - 집계 2종  → [nightlyStatsBatch](./nightlyStatsBatch.ts)      매일 02:00
 *  - 백업·보험 → **이 함수**                                       매일 02:20
 *  - 유지보수 3종 → [weeklyMaintenanceBatch](./weeklyMaintenanceBatch.ts) 매주 일 03:00
 *
 * 쪼개면서 얻는 것은 메모리만이 아니다. 예전 구조에서는 어느 한 스텝이 죽어 인스턴스가
 * 강제 종료되면 `retryCount` 재실행이 **일곱 스텝 전부**를 처음부터 다시 돌렸다
 * (2026-08-15 OOM에서 실제로 발생). 이제 재실행 범위가 해당 배치 안으로 제한된다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { log } from "../../utils/helpers";
import { getKSTDateString } from "../../utils/kstDate";
import { createInAppNotification, sendPushToUser } from "../../services/alimtalk/sendNotification";
import { captureWarning } from "../../core/sentry";
import { runStep, logBatchResult } from "../../utils/batchStep";
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

/** 오늘 백업이 놓이는 버킷 내부 경로(접두사). 존재 확인용이라 끝에 `/`를 붙인다. */
export function buildBackupPrefix(dateStr: string): string {
    return `backups/firestore/${dateStr}/`;
}

/**
 * "이미 오늘 export가 걸려 있다"는 신호인지 판별한다.
 *
 * Firestore export는 `outputUriPrefix`의 마지막 경로 조각으로
 * `<prefix>/<날짜>.overall_export_metadata`를 만드는데, 그 객체가 이미 있으면 요청 자체를
 * `3 INVALID_ARGUMENT: Path already exists: ...`로 거절한다. 즉 이 에러는 **실패가 아니라
 * 같은 날 두 번째 실행**이라는 뜻이다.
 */
export function isPathAlreadyExists(e: unknown): boolean {
    return /Path already exists/i.test((e as { message?: string } | null)?.message ?? "");
}

/** gRPC PERMISSION_DENIED(코드 7) 판별 */
function isPermissionDenied(e: unknown): boolean {
    const err = e as { code?: number | string; message?: string } | null;
    return err?.code === 7 || /PERMISSION_DENIED/.test(err?.message ?? "");
}

/**
 * export 실패를 **행동 가능한** 메시지로 바꾼다.
 *
 * 이 알림은 매일 밤 Sentry·Discord로 나가는데, 원문(`7 PERMISSION_DENIED: The caller does not
 * have permission`)만으로는 받는 사람이 문서를 뒤져야 한다. 그런데 여기까지 왔다는 것은 이미
 * **원인이 하나로 좁혀졌다는 뜻**이다 — 버킷 부재는 앞의 `exists()`에서 걸리고, 리전 불일치는
 * PERMISSION_DENIED가 아니라 `... is in location ...` 400으로 온다. 남는 것은 IAM뿐이다.
 * 그 판정과 조치 명령을 메시지에 함께 실어, 알림 하나로 끝낼 수 있게 한다.
 *
 * SA 이메일을 코드에 박지 않는다 — 프로젝트 번호는 런타임 환경에 없고, 박아 두면 문서와
 * 갈라져 낡는다. 자리표시자로 형태만 보여주고 구체값은 문서(§2.6)에 둔다.
 *
 * **명령은 한 줄로 낸다.** 줄바꿈에 `\`를 쓰면 bash에서는 되지만 PowerShell에서는
 * "단항 연산자 '--' 뒤에 식이 없습니다"로 깨진다. 이 서비스의 운영자는 Windows에서 조치하므로
 * (2026-08-10에 실제로 이 형태로 붙여 넣어 실패했다) 두 셸에서 모두 되는 한 줄 형태만 쓴다.
 */
export function describeExportFailure(e: unknown, outputUri: string, projectId: string | undefined, bucketName: string): string {
    const base = `Firestore export 실패 (outputUriPrefix=${outputUri}): ${(e as Error).message}`;
    if (!isPermissionDenied(e)) return base;

    const project = projectId ?? "<projectId>";
    return [
        base,
        "",
        `버킷 gs://${bucketName} 은(는) 존재가 확인된 뒤 거부됐다 → 남는 원인은 IAM뿐이다.`,
        "export는 장기 실행 작업이라 호출 즉시 나는 거부는 대개 **호출자(런타임 SA) 권한**이다. 이 순서로 확인:",
        "  1) 런타임 SA에 export 권한",
        `     gcloud projects add-iam-policy-binding ${project} --member="serviceAccount:<projectNumber>-compute@developer.gserviceaccount.com" --role="roles/datastore.importExportAdmin"`,
        "  2) 그래도 나면 Firestore 서비스 에이전트에 버킷 쓰기",
        `     gcloud storage buckets add-iam-policy-binding gs://${bucketName} --member="serviceAccount:service-<projectNumber>@gcp-sa-firestore.iam.gserviceaccount.com" --role="roles/storage.admin"`,
        "구체적인 계정 값과 진단 지름길: .agent/skills/troubleshoot-deployment/SKILL.md §2.6",
    ].join("\n");
}

/**
 * 백업 스킵을 **경고로 올린다.** 스킵 자체는 정상 동작이지만, 스킵이 일어났다는 사실은
 * "오늘 배치가 두 번 돌았다"는 뜻이고 그건 정상이 아니다.
 *
 * 이 알림이 필요한 이유는 **OOM·타임아웃이 스스로를 신고하지 못하기 때문**이다. 인스턴스가
 * 통째로 죽으면 `runStep`의 catch도 `captureError`도 실행될 기회가 없어 Sentry·Discord에
 * 아무것도 남지 않는다. 2026-08-15의 OOM을 우리가 알아챈 유일한 경로는 재실행이 낸
 * "Path already exists" 오알림이었는데, 그 오알림을 없애면서 **유일한 탐지 수단까지 사라졌다.**
 * 그 자리를 이 경고가 대신한다 — 없으면 다음 OOM은 아무도 모르는 채 집계·통계 비용만 두 배로 나간다.
 *
 * 경고에는 다음 조사 지점을 함께 싣는다. 받는 사람이 문서를 뒤지지 않고 바로 로그를 열 수 있어야 한다.
 */
function warnDuplicateRun(reason: string, outputUri: string): void {
    captureWarning(`야간 배치가 같은 날 두 번 실행됨 — ${reason}`, {
        context: "dailyNightlyBatch",
        step: "backupFirestore",
        outputUri,
        의미: "백업은 정상. 다만 배치가 오늘 두 번 돌았다는 뜻이라 1차 실행이 끝을 못 봤을 수 있다.",
        확인: "함수 로그에서 'Memory limit ... exceeded'(OOM) 또는 'finished with status: timeout'을 찾을 것. " +
            "1차 실행에 '[Batch] dailyNightlyBatch completed'가 없으면 죽은 것이다.",
        참고: ".agent/skills/troubleshoot-deployment/SKILL.md §2.8",
    });
}

/** 완료 표식 파일명. Firestore export가 **끝날 때** 이 이름으로 쓴다. */
export function buildCompletionMarker(dateStr: string): string {
    return `${buildBackupPrefix(dateStr)}${dateStr}.overall_export_metadata`;
}

/** KST 기준 어제 날짜('YYYY-MM-DD'). */
export function previousKstDateString(now: Date = new Date()): string {
    return getKSTDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export type BackupState = "complete" | "incomplete" | "missing";

/**
 * 어느 날의 백업이 **끝났는지** 파일 목록으로 판정한다.
 *
 * `overall_export_metadata`는 export가 완료될 때 쓰이므로, 출력 파일은 있는데 이 표식만
 * 없으면 **시작만 되고 끝나지 않은** 상태다. 그 구분이 이 함수의 전부다.
 */
export function classifyBackupState(fileNames: string[], dateStr: string): BackupState {
    if (fileNames.length === 0) return "missing";
    return fileNames.includes(buildCompletionMarker(dateStr)) ? "complete" : "incomplete";
}

/** 미완료 백업을 **행동 가능한** 메시지로 바꾼다. */
export function describeBackupGap(state: Exclude<BackupState, "complete">, dateStr: string, bucketName: string): string {
    const uri = buildBackupUri(bucketName, dateStr);
    if (state === "missing") {
        return [
            `어제(${dateStr}) Firestore 백업이 없다: ${uri} 아래에 객체가 하나도 없다.`,
            "배치가 아예 돌지 않았거나(스케줄러 중단·함수 배포 실패), export 호출 자체가 거부됐다.",
            "함수 로그에서 그날의 dailyNightlyBatch 실행과 'Firestore backup started'를 확인할 것.",
        ].join(" ");
    }
    return [
        `어제(${dateStr}) Firestore 백업이 **끝나지 않았다**: ${uri} 에 출력 파일은 있는데`,
        "완료 표식(.overall_export_metadata)이 없다.",
        "export는 장기 실행 작업이라 호출은 성공하고 나중에 실패할 수 있다 — 지금까지 이 경우를",
        "아무도 알아채지 못했다. GCP 콘솔의 Firestore > 가져오기/내보내기에서 그날 작업의 상태를 확인하고,",
        "실패했다면 그날치는 복구할 수 없으므로 보관 정책상 문제가 되는지 판단할 것.",
    ].join(" ");
}

/**
 * Step 1: **어제** 백업이 끝났는지 확인한다.
 *
 * 오늘 백업(Step 0)은 export를 걸고 "시작됨"만 남긴 뒤 끝난다 — 관리형 export가 장기 실행
 * 작업이라 완료를 그 자리에서 기다릴 수 없기 때문이다. 그래서 **호출이 성공해도 나중에 실패하면
 * 아무도 몰랐다.** OPERATIONS.md §4.1이 "알림이 없다고 백업이 있는 것은 아니다"라고 적어 둔
 * 바로 그 구멍이고, 지금까지 사람이 버킷을 눈으로 봐야만 알 수 있었다.
 *
 * 완료를 그 자리에서 기다리는 대신 **하루 뒤에 확인한다.** 발견이 최대 24시간 늦지만, 폴링으로
 * 함수를 몇 분씩 붙잡아 두는 것보다 훨씬 싸다(목록 조회 1회). 백업 실패는 분 단위로 다툴 일이
 * 아니라, "영영 모른다"를 "하루 안에 안다"로 바꾸는 것이 실질적인 이득이다.
 *
 * 보관 90일 · 매일 02:20 실행이므로 어제 폴더가 수명 주기로 지워질 일은 없다.
 */
export async function verifyPreviousBackup() {
    console.log("[Batch] Starting verifyPreviousBackup...");
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const bucketName = resolveBackupBucket(projectId);
    const backupBucket = getStorage().bucket(bucketName);

    const dateStr = previousKstDateString();

    let names: string[];
    try {
        const [files] = await backupBucket.getFiles({ prefix: buildBackupPrefix(dateStr) });
        names = files.map((f) => f.name);
    } catch (e: unknown) {
        // 확인 실패는 백업 실패가 아니다. 목록 권한이 없다고 어제 백업이 없다고 단정하면
        // 헛경보가 된다 — 조용히 넘기되 로그에는 남긴다.
        console.warn(`어제 백업 확인 실패 — 판정을 건너뛴다: ${(e as Error).message}`);
        return;
    }

    const state = classifyBackupState(names, dateStr);
    if (state === "complete") {
        console.log(`Previous backup verified: ${buildBackupUri(bucketName, dateStr)} (파일 ${names.length}건)`);
        return;
    }

    // 아직 백업이 한 번도 없는 프로젝트(첫 배포 직후)에서 헛경보를 내지 않는다.
    // 불행한 경로에서만 목록을 한 번 더 부른다.
    if (state === "missing") {
        try {
            const [any] = await backupBucket.getFiles({ prefix: "backups/firestore/", maxResults: 1 });
            if (any.length === 0) {
                console.log("백업 이력이 아직 없다 — 첫 배포 직후로 보고 어제 백업 확인을 건너뛴다.");
                return;
            }
        } catch {
            // 확인 못 했으면 아래에서 정상적으로 보고한다.
        }
    }

    throw new Error(describeBackupGap(state, dateStr, bucketName));
}

/**
 * Step 0: Firestore 전체 백업 (기존 backupFirestore 로직 통합)
 *
 * **하루에 한 번만 export를 건다.** 이 배치는 하루 한 번 도는 것을 전제로 짜여 있지만 실제로는
 * 같은 날 두 번 실행될 수 있다 — 스케줄 함수는 Pub/Sub 기반이라 전달이 at-least-once이고,
 * `retryCount: 1`이 붙어 있어 핸들러가 타임아웃 등으로 던지면 한 번 더 돌며, 운영자가 수동으로
 * 재실행하기도 한다. 다른 스텝은 두 번 돌아도 문제가 없지만(퍼지·정리·집계는 멱등, 알림은
 * 발송 여부 플래그로 막힘) export만은 대상 경로가 날짜로 고정돼 있어 두 번째 실행이
 * `3 INVALID_ARGUMENT: Path already exists`로 떨어졌고, 그 실패가 매일 밤 Sentry·Discord
 * 알림으로 나갔다(2026-08-15).
 *
 * 그래서 오늘 폴더에 이미 무언가 있으면 export를 걸지 않고 넘어간다. 알림을 줄이려는 것만이
 * 아니다 — 관리형 export는 전체 문서를 읽어 **읽기 비용이 청구**되므로, 같은 날 두 번째 export는
 * 만들어져도 비용만 두 배가 되는 중복 사본이다.
 */
export async function backupFirestoreData() {
    console.log("[Batch] Starting backupFirestore...");
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const bucketName = resolveBackupBucket(projectId);
    const backupBucket = getStorage().bucket(bucketName);

    // 버킷 부재를 먼저 확인한다. 이 검사가 없으면 export가 PERMISSION_DENIED로 떨어져
    // "권한 문제"로 오독하게 된다 — 실제로 그 오독 때문에 원인 규명이 늦어졌다.
    const [bucketExists] = await backupBucket.exists();
    if (!bucketExists) {
        throw new Error(
            `백업 버킷 gs://${bucketName} 이(가) 없다. Firestore와 같은 리전(asia-northeast3)에 ` +
            `생성하거나 FIRESTORE_BACKUP_BUCKET 환경변수로 다른 이름을 지정할 것. ` +
            `(기본 버킷은 us-east1이라 Firestore export 대상이 될 수 없다 — OPERATIONS.md §4.1)`
        );
    }

    const dateStr = getKSTDateString(new Date());
    const outputUri = buildBackupUri(bucketName, dateStr);

    // 완료 표식(`.overall_export_metadata`)만 보지 않고 **접두사 아래 객체 하나라도** 있는지 본다.
    // 그 표식은 export가 끝날 때 쓰이므로, 앞선 실행이 아직 진행 중이면 표식은 없고 출력 파일만
    // 쌓여 있는 상태가 된다. 그때도 중복 export를 걸지 않아야 한다. (maxResults: 1 — 목록 1건만)
    //
    // 이 확인이 실패하면(예: 런타임 SA의 객체 목록 권한 누락) **백업을 포기하지 않고 그대로 진행한다.**
    // 중복 방지는 편의고 백업은 본론이다 — 확인 한 번 못 했다고 그날 백업이 통째로 없어지면 안 된다.
    // 진행했다가 정말 중복이면 아래 catch의 "Path already exists"가 받아낸다.
    let alreadyBackedUp = false;
    try {
        const [existing] = await backupBucket.getFiles({ prefix: buildBackupPrefix(dateStr), maxResults: 1 });
        alreadyBackedUp = existing.length > 0;
    } catch (e: unknown) {
        console.warn(`오늘 백업 존재 확인 실패 — 중복 검사 없이 export를 진행한다: ${(e as Error).message}`);
    }
    if (alreadyBackedUp) {
        console.log(`Firestore backup skipped: ${outputUri} 에 오늘 백업이 이미 있다 (중복 export 방지).`);
        warnDuplicateRun("오늘 백업이 이미 있어 export를 건너뜀", outputUri);
        return;
    }

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
        // 위 사전 확인과 이 호출 사이에 다른 실행이 먼저 export를 건 경우(동시 실행 경합).
        // 백업은 이미 있으므로 실패가 아니다 — 알림으로 올리지 않는다.
        if (isPathAlreadyExists(e)) {
            console.log(`Firestore backup skipped: ${outputUri} 에 다른 실행이 이미 export를 걸었다.`);
            warnDuplicateRun("다른 실행이 이미 export를 걸어 건너뜀", outputUri);
            return;
        }
        // 대상 URI를 에러 메시지에 실어야 Sentry만 보고도 버킷 오지정·위치 불일치·IAM 누락을 구분할 수 있다.
        // PERMISSION_DENIED면 원인이 IAM 하나로 좁혀지므로 조치 명령까지 함께 싣는다.
        throw new Error(describeExportFailure(e, outputUri, projectId, bucketName), { cause: e });
    }
}

export async function purgeOrgs(db: FirebaseFirestore.Firestore) {
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

export async function cleanupImages(db: FirebaseFirestore.Firestore, bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>) {
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

const CONTEXT = "dailyNightlyBatch";

export const dailyNightlyBatch = onSchedule(
    {
        // 02:20 — 같은 시각에 두 배치가 겹치지 않도록 nightlyStatsBatch(02:00) 뒤로 물린다.
        schedule: "20 2 * * *",
        timeZone: "Asia/Seoul",
        // 백업은 하루 놓치면 그날치가 영영 없다. 두 스텝 모두 멱등하므로(백업은 오늘 폴더
        // 존재 확인으로, 보험 알림은 insuranceExpiryNotifiedFor 플래그로) 재실행이 안전하다.
        retryCount: 1,
        // 집계 2스텝을 nightlyStatsBatch로 분리해 문서 수만 건이 이 프로세스에 없다.
        // 2026-08-15 OOM의 전제가 사라졌으므로 규칙(§3.2)의 백업 기본값으로 되돌린다.
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        const db = getFirestore();

        const failed: string[] = [];

        await runStep(failed, CONTEXT, "backupFirestore", () => backupFirestoreData());
        // 오늘 백업을 건 **뒤에** 어제 것을 확인한다. 순서가 중요한 건 아니지만(runStep이
        // 스텝을 격리한다) 본론이 먼저 나가는 편이 로그를 읽기 쉽다.
        await runStep(failed, CONTEXT, "verifyPreviousBackup", () => verifyPreviousBackup());
        await runStep(failed, CONTEXT, "checkInsuranceExpiry", () => checkInsuranceExpiry(db));

        await logBatchResult(CONTEXT, failed);
    }
);
