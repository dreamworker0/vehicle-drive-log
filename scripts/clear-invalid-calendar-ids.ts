/**
 * 정리 스크립트: 캘린더 ID 칸에 들어간 잘못된 값을 고치거나 비운다
 *
 * 배경: 2026-08-23 캘린더 바인딩 시딩(scripts/seed-calendar-bindings.ts)에서 두 종류의
 * 잘못된 입력이 드러났다.
 *
 *  (1) **공유 대상 서비스 계정 주소**를 캘린더 ID 칸에 붙여 넣은 차량 — FAQ가 "캘린더를
 *      이 주소와 *공유*하라"고 안내하는 값이다(shared/faqData.ts). 3개 기관·차량 8대가
 *      같은 주소를 가리키고 있었다. 어느 기관의 캘린더도 아니면서 여러 기관이 같은 곳을
 *      가리키게 만드는 값이라 서버가 이미 동기화를 거절한다(calendarBinding.ts).
 *  (2) **캘린더 화면 URL을 그대로 붙여 넣은 값**(`@` 없음) — 동기화가 건너뛴다. 그런데
 *      그 URL 안에는 **진짜 캘린더 ID가 URL 인코딩된 채 들어 있는 경우가 많다**
 *      (`?src=c_abc%40group.calendar.google.com`, `/ical/main%40example.or.kr/`).
 *      그런 값은 지울 대상이 아니라 **고칠 대상**이다 — 비우면 복구 가능한 설정을 없앤다.
 *      캘린더 ID가 아예 없는 화면 URL(`/r/month/2026/8/1`)만 비운다.
 *
 * 셋 다 보안 위험은 서버 가드로 이미 닫혀 있다. 이 스크립트가 하는 일은 **죽은 설정을
 * 살리거나 치우는 것**이다: 값이 남아 있으면 관리자 화면에 '연동됨'으로 보이고 '동기화 실패'
 * 배지가 계속 붙어, 기관이 무엇을 고쳐야 하는지 알 수 없다.
 *
 * ## 안전 장치 — 기본이 조회다
 *
 * 저장소의 다른 마이그레이션 스크립트는 기본 실행 + `--dry-run` 옵트인이지만, 이 스크립트는
 * **기본이 조회이고 `--apply`를 줘야 쓴다.** 값을 덮어쓰는 동작이라 되돌릴 원본이 화면
 * 어디에도 남지 않기 때문이다(기관이 다시 입력해야 한다). 판별을 잘못하면 정상 캘린더를
 * 지우거나 엉뚱한 ID를 심게 되므로, 한 번 더 확인하는 편이 싸다. 바꾸기 전·후 값을 전부
 * 출력하므로 그 출력을 보관하면 복구 근거가 된다.
 *
 * 사용법:
 *   npx tsx scripts/clear-invalid-calendar-ids.ts            # 대상만 조회 (쓰기 없음)
 *   npx tsx scripts/clear-invalid-calendar-ids.ts --apply    # 고칠 것은 고치고, 비울 것은 비운다
 *   npx tsx scripts/clear-invalid-calendar-ids.ts --apply --only=url      # URL → ID 복구만
 *   npx tsx scripts/clear-invalid-calendar-ids.ts --apply --only=service-account
 *   npx tsx scripts/clear-invalid-calendar-ids.ts --apply --only=malformed
 *
 * 멱등: 이미 비워진 차량은 대상에서 빠진다. 여러 번 돌려도 같은 결과다.
 *
 * 필요 환경변수(선택):
 *   GOOGLE_APPLICATION_CREDENTIALS — 서비스 계정 키 경로 (없으면 gcloud ADC)
 *   GOOGLE_CLOUD_PROJECT           — 대상 프로젝트 (없으면 .firebaserc의 default)
 */
import { getFirestore } from "firebase-admin/firestore";
import { calendarIdFromUrl } from "./lib/calendarIdFromUrl";
import { initAdminApp, resolveProjectId } from "./lib/adminApp";

const args = process.argv.slice(2);
const isApply = args.includes("--apply");
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const ONLY_VALUES = ["service-account", "url", "malformed"] as const;
if (only && !(ONLY_VALUES as readonly string[]).includes(only)) {
    console.error(`--only 값이 올바르지 않습니다: ${only} (${ONLY_VALUES.join(" | ")})`);
    process.exit(1);
}

// 대상 프로젝트를 고정하는 이유는 lib/adminApp.ts에 있다.
// projectId는 아래 출력·오류 안내에서 쓴다.
const projectId = resolveProjectId();
const db = getFirestore(initAdminApp({ quiet: true }));

type Reason = "service-account" | "url" | "malformed";

interface Target {
    vehicleId: string;
    orgId: string;
    displayName: string;
    value: string;
    reason: Reason;
    /** url 유형에서 URL에서 뽑아낸 진짜 캘린더 ID (그 외에는 null → 비움) */
    recovered: string | null;
    failCount: number;
}

/** 판별 규칙 — functions/src/services/calendar/calendarBinding.ts와 같은 기준 */
function classify(raw: string): { reason: Reason; recovered: string | null } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase().endsWith(".gserviceaccount.com")) {
        return { reason: "service-account", recovered: null };
    }
    if (trimmed.includes("@")) return null; // 이미 동기화가 쓰는 형태 — 건드리지 않는다
    const recovered = calendarIdFromUrl(trimmed);
    if (recovered) return { reason: "url", recovered };
    return { reason: "malformed", recovered: null };
}

const REASON_LABEL: Record<Reason, string> = {
    "service-account": "공유 대상 서비스 계정 주소 (캘린더 ID가 아니다) → 비움",
    url: "캘린더 화면 URL — 안에서 진짜 ID를 찾았다 → 고침",
    malformed: "캘린더 ID가 없는 화면 URL·문자열 → 비움",
};

async function run() {
    console.log(`=== 잘못된 캘린더 ID 정리 ${isApply ? "(실제 적용)" : "(조회만 — 쓰기 없음)"} ===\n`);
    console.log(`대상 프로젝트: ${projectId ?? "(미지정 — ADC 기본값)"}`);
    if (process.env.FIRESTORE_EMULATOR_HOST) {
        console.log(`⚠️  에뮬레이터 접속 중(FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}) — 프로덕션이 아닙니다`);
    }
    if (only) console.log(`대상 한정: ${only}`);
    console.log("");

    const snap = await db.collection("vehicles").get();

    const targets: Target[] = [];
    for (const doc of snap.docs) {
        const data = doc.data();
        const raw = data.googleCalendarId;
        if (typeof raw !== "string") continue;
        const verdict = classify(raw);
        if (!verdict) continue;
        if (only && verdict.reason !== only) continue;
        targets.push({
            vehicleId: doc.id,
            orgId: (data.organizationId as string) || "(기관 없음)",
            displayName: (data.displayName as string) || "(이름 없음)",
            value: raw,
            reason: verdict.reason,
            recovered: verdict.recovered,
            failCount: (data.calendarSyncFailCount as number) || 0,
        });
    }

    console.log(`읽은 차량 문서: ${snap.size}대`);
    if (snap.size === 0) {
        // 0건은 "깨끗함"이 아니라 **점검이 이루어지지 않은 것**이다 (seed 스크립트와 같은 함정).
        console.error(`\n⚠️  차량 문서를 한 건도 읽지 못했습니다 — 점검이 이루어지지 않았습니다.\n`);
        console.error(`조회한 프로젝트: ${projectId ?? "(미지정)"}`);
        console.error(`  PowerShell:  $env:GOOGLE_CLOUD_PROJECT = "vehicle-drive-log"`);
        console.error(`  gcloud로 로그인하면 ADC의 기본 프로젝트가 다른 곳으로 잡혀 있을 수 있습니다.\n`);
        process.exit(1);
    }

    if (targets.length === 0) {
        console.log(`정리할 대상이 없습니다 — 잘못된 캘린더 ID가 남아 있지 않습니다.`);
        console.log(`\n=== 완료 ===`);
        return;
    }

    // 기관별로 묶어 보여 준다 — 어느 기관에 안내해야 하는지가 이 출력의 목적이다.
    const byOrg = new Map<string, Target[]>();
    for (const t of targets) {
        const list = byOrg.get(t.orgId) ?? [];
        list.push(t);
        byOrg.set(t.orgId, list);
    }

    const repairCount = targets.filter((t) => t.recovered).length;
    const clearCount = targets.length - repairCount;
    console.log(`정리 대상: 차량 ${targets.length}대 / 기관 ${byOrg.size}곳  (고침 ${repairCount}대 · 비움 ${clearCount}대)\n`);
    for (const [orgId, list] of byOrg) {
        console.log(`기관 ${orgId} — ${list.length}대`);
        for (const t of list) {
            console.log(`  · ${t.displayName} (${t.vehicleId})`);
            console.log(`      현재 값: ${t.value}`);
            console.log(t.recovered ? `      → 고칠 값: ${t.recovered}` : `      → 비운다 (복구할 ID가 없음)`);
            console.log(`      사유: ${REASON_LABEL[t.reason]}${t.failCount > 0 ? ` · 누적 동기화 실패 ${t.failCount}회` : ""}`);
        }
        console.log("");
    }

    // 고친 값이 기관 사이에서 겹치면 바인딩 단계에서 한쪽이 막힌다 — 미리 드러낸다.
    const recoveredOwners = new Map<string, Set<string>>();
    for (const t of targets) {
        if (!t.recovered) continue;
        const key = t.recovered.toLowerCase();
        const set = recoveredOwners.get(key) ?? new Set<string>();
        set.add(t.orgId);
        recoveredOwners.set(key, set);
    }
    const crossOrg = [...recoveredOwners.entries()].filter(([, orgs]) => orgs.size > 1);
    if (crossOrg.length > 0) {
        console.log(`⚠️  고칠 값이 여러 기관에 걸쳐 있습니다 (${crossOrg.length}건) — 적용 전에 확인하세요:`);
        for (const [id, orgs] of crossOrg) console.log(`   ${id} → 기관 ${[...orgs].join(", ")}`);
        console.log(`   먼저 쓰는 기관이 선점하고 나머지는 동기화가 막힙니다.\n`);
    }

    if (!isApply) {
        console.log(`쓰기는 하지 않았습니다. 위 목록을 확인한 뒤 --apply로 실제 적용하세요.`);
        console.log(`  npx tsx scripts/clear-invalid-calendar-ids.ts --apply`);
        console.log(`\n적용 후에는 해당 기관에 안내가 필요합니다:`);
        console.log(`  "서비스 계정 주소는 캘린더 '공유' 대상에만 넣고,`);
        console.log(`   차량의 '캘린더 ID' 칸에는 구글 캘린더 설정 → 캘린더 통합의 '캘린더 ID'를 넣어주세요."`);
        console.log(`\n=== 완료 ===`);
        return;
    }

    // Firestore 배치 상한(500)을 고려해 청크로 커밋 (선례: backfillDriveLogCreatedBy)
    let batch = db.batch();
    let batchCount = 0;
    let cleared = 0;

    let repaired = 0;
    for (const t of targets) {
        // 값을 고치거나 비우면서 실패 카운터도 함께 되돌린다. 남겨 두면 '동기화 실패'
        // 배지가 계속 붙어, 기관이 무엇을 고쳐야 하는지 알 수 없다.
        // (resetCalendarFailure와 같은 방식 — 카운터를 0으로. 화면의 캘린더 ID 변경
        //  경로도 같은 초기화를 한다 — useVehicleManager.)
        batch.update(db.collection("vehicles").doc(t.vehicleId), {
            googleCalendarId: t.recovered ?? "",
            calendarSyncFailCount: 0,
        });
        batchCount++;
        if (t.recovered) repaired++; else cleared++;
        if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) await batch.commit();

    console.log(`고친 차량: ${repaired}대 · 비운 차량: ${cleared}대`);
    if (repaired > 0) {
        console.log(`\n고친 차량은 다음 동기화(평일 06~22시 30분 주기)에서 캘린더를 처음 쓰는`);
        console.log(`시점에 그 기관으로 바인딩이 선점 등록됩니다. 그래도 동기화가 안 되면 해당`);
        console.log(`캘린더를 서비스 계정과 공유했는지 확인하세요(관리자 화면의 '연동 문제 진단').`);
    }
    console.log(`\n비운 차량이 있는 기관에는 안내해 주세요:`);
    console.log(`  "서비스 계정 주소는 캘린더 '공유' 대상에만 넣고,`);
    console.log(`   차량의 '캘린더 ID' 칸에는 구글 캘린더 설정 → 캘린더 통합의 '캘린더 ID'를 넣어주세요."`);
    console.log(`\n=== 완료 ===`);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
