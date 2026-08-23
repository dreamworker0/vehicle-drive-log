/**
 * 시딩 스크립트: 현재 등록된 차량 캘린더 ID를 기관 바인딩으로 확정
 *
 * 배경: 캘린더 동기화는 모든 기관이 같은 서비스 계정에 자기 캘린더를 공유하는 구조라,
 *       차량 문서의 googleCalendarId(관리자 자유 입력)가 유일한 선택자였다. 다른 기관의
 *       캘린더 ID를 적으면 그 기관의 일정이 우리 예약으로 유입되고, 우리가 그 예약을
 *       지우면 원본 일정이 지워졌다 (2026-08-23 감사 발견 1).
 *
 *       조치로 `calendarBindings/{sha256(캘린더ID)}` 정본을 두고 **선점 등록**한다.
 *       그런데 선점만으로는 아직 동기화를 돌리지 않은 기관의 ID를 남이 먼저 차지할 수
 *       있으므로, **이미 연동 중인 기관의 현재 상태를 먼저 이 스크립트로 굳힌다.**
 *       배포 직후 1회 실행이 조치의 일부다 — 건너뛰면 선점 창이 열려 있다.
 *
 * 충돌 보고: 서로 다른 기관의 차량이 같은 캘린더 ID를 쓰고 있으면 **먼저 발견된 기관으로
 *       등록하지 않고 건너뛰고 목록에 남긴다.** 어느 쪽이 정당한지는 코드가 판단할 수 없고,
 *       임의로 정하면 정당한 기관의 연동을 끊게 된다. 운영자가 확인해 수동 등록한다.
 *       (이미 진행 중인 유출의 흔적일 수도 있으므로 반드시 확인할 것)
 *
 * 사용법:
 *   npx tsx scripts/seed-calendar-bindings.ts            # 실제 실행
 *   npx tsx scripts/seed-calendar-bindings.ts --dry-run  # 변경 없이 대상만 집계
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 */
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const isDryRun = process.argv.includes("--dry-run");

// ESM 스코프에는 __dirname이 없다(루트 package.json이 "type": "module").
// 스크립트 파일 위치 기준으로 경로를 계산한다 (migrateGoogleOauthToPrivate.ts와 같은 방식).
const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Firebase Admin 초기화 — 서비스 계정 키 파일이 있으면 그것을, 없으면 기본 인증
 * (GOOGLE_APPLICATION_CREDENTIALS 또는 gcloud ADC)을 쓴다.
 * 키 파일 위치는 저장소의 두 선례를 모두 본다(functions/ 아래와 루트).
 */
function initAdmin() {
    for (const candidate of [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        resolve(scriptDir, "../functions/serviceAccountKey.json"),
        resolve(scriptDir, "../serviceAccountKey.json"),
    ]) {
        if (candidate && existsSync(candidate)) {
            const sa = JSON.parse(readFileSync(candidate, "utf-8")) as ServiceAccount;
            return initializeApp({ credential: cert(sa) });
        }
    }
    return initializeApp();
}

const app = initAdmin();
const db = getFirestore(app);

/**
 * 어느 프로젝트를 읽고 있는지 최선으로 판별한다.
 *
 * 이 스크립트가 0건을 보고했을 때 "연동 차량이 없다"와 "엉뚱한 프로젝트를 읽었다"를
 * 구분할 수 없으면, 운영자는 선점 창이 닫혔다고 오인한 채 넘어간다. 판별 근거를 항상 찍는다.
 */
function describeTarget(): string {
    const fromOptions = app.options.projectId;
    const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const parts = [`프로젝트: ${fromOptions || fromEnv || "(확인 불가 — ADC가 내부적으로 결정)"}`];
    if (emulator) parts.push(`⚠️ 에뮬레이터 접속 중(FIRESTORE_EMULATOR_HOST=${emulator}) — 프로덕션이 아니다`);
    return parts.join("\n");
}

/** functions/src/services/calendar/calendarBinding.ts와 같은 규칙이어야 한다 */
function normalizeCalendarId(calendarId: string): string {
    return calendarId.trim().toLowerCase();
}
function calendarBindingKey(calendarId: string): string {
    return createHash("sha256").update(normalizeCalendarId(calendarId), "utf8").digest("hex");
}

async function seed() {
    console.log(`=== 캘린더 바인딩 시딩 시작 ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    console.log(describeTarget() + "\n");

    const snap = await db.collection("vehicles").get();

    // 캘린더 ID → 그 ID를 쓰는 기관 집합 (충돌 판별용)
    const owners = new Map<string, { normalized: string; orgIds: Set<string>; vehicleIds: string[] }>();

    // 제외 사유별 집계 — "0개"의 뜻을 읽을 수 있게 한다
    let noCalendarId = 0;
    let invalidFormat = 0;
    let noOrgId = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const raw = data.googleCalendarId as string | undefined;
        const orgId = data.organizationId as string | undefined;
        // 동기화가 요구하는 최소 형식(@ 포함)을 만족하지 않는 값은 애초에 쓰이지 않는다
        if (!raw) { noCalendarId++; continue; }
        if (!raw.includes("@")) { invalidFormat++; continue; }
        if (!orgId) { noOrgId++; continue; }

        const normalized = normalizeCalendarId(raw);
        const key = calendarBindingKey(normalized);
        const entry = owners.get(key) ?? { normalized, orgIds: new Set<string>(), vehicleIds: [] };
        entry.orgIds.add(orgId);
        entry.vehicleIds.push(doc.id);
        owners.set(key, entry);
    }

    let created = 0;
    let alreadyBound = 0;
    const conflicts: string[] = [];

    for (const [key, entry] of owners) {
        if (entry.orgIds.size > 1) {
            conflicts.push(
                `  ⚠️  ${entry.normalized} — 기관 ${[...entry.orgIds].join(", ")} (차량 ${entry.vehicleIds.join(", ")})`
            );
            continue;
        }
        const orgId = [...entry.orgIds][0];
        const ref = db.collection("calendarBindings").doc(key);
        const existing = await ref.get();
        if (existing.exists) {
            alreadyBound++;
            const owner = existing.data()?.organizationId as string | undefined;
            if (owner !== orgId) {
                conflicts.push(`  ⚠️  ${entry.normalized} — 이미 기관 ${owner}에 등록됨 (차량 소속은 ${orgId})`);
            }
            continue;
        }
        if (!isDryRun) {
            await ref.set({
                calendarId: entry.normalized,
                organizationId: orgId,
                firstBoundAt: FieldValue.serverTimestamp(),
                boundBy: "seed-calendar-bindings",
            });
        }
        created++;
    }

    console.log(`읽은 차량 문서: ${snap.size}대`);
    console.log(`  캘린더 ID 없음: ${noCalendarId}대 · 형식 부적합(@ 없음): ${invalidFormat}대 · 기관 ID 없음: ${noOrgId}대`);
    console.log(`캘린더를 쓰는 차량이 가리키는 고유 캘린더: ${owners.size}개`);
    console.log(`  ${isDryRun ? "등록 예정" : "등록"}: ${created}개`);
    console.log(`  이미 등록됨(스킵): ${alreadyBound}개`);
    if (conflicts.length > 0) {
        console.log(`\n확인 필요 (등록하지 않음) — ${conflicts.length}건:`);
        conflicts.forEach((c) => console.log(c));
        console.log(`\n한 캘린더를 둘 이상의 기관이 가리키고 있습니다. 정당한 소유 기관을 확인한 뒤`);
        console.log(`calendarBindings 문서를 직접 만들고, 잘못 등록된 차량의 캘린더 ID를 비워주세요.`);
    }
    if (snap.size === 0) {
        console.log(`\n⚠️  차량 문서를 한 건도 읽지 못했습니다.`);
        console.log(`   "연동 차량이 없음"이 아니라 **다른 프로젝트를 읽었거나 권한이 없는** 상태일 수 있습니다.`);
        console.log(`   위의 '프로젝트:' 값이 운영 프로젝트인지 확인하세요.`);
        console.log(`   (gcloud config get-value project / firebase use / GOOGLE_CLOUD_PROJECT 환경변수)`);
    } else if (owners.size === 0) {
        console.log(`\n차량은 ${snap.size}대 읽었지만 캘린더를 연동한 차량이 없습니다 — 등록할 바인딩이 없는 정상 상태입니다.`);
        console.log(`(앞으로 어느 기관이 캘린더를 연동하면 그 시점에 자동으로 선점 등록됩니다.)`);
    }
    console.log(`\n=== 시딩 완료 ===`);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
