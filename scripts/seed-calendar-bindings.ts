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
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import * as path from "path";
import * as fs from "fs";

const isDryRun = process.argv.includes("--dry-run");

const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json");

let app;
try {
    const serviceAccountStr = fs.readFileSync(keyPath, "utf-8");
    const serviceAccount = JSON.parse(serviceAccountStr) as ServiceAccount;
    app = initializeApp({ credential: cert(serviceAccount) });
} catch {
    app = initializeApp();
}

const db = getFirestore(app);

/** functions/src/services/calendar/calendarBinding.ts와 같은 규칙이어야 한다 */
function normalizeCalendarId(calendarId: string): string {
    return calendarId.trim().toLowerCase();
}
function calendarBindingKey(calendarId: string): string {
    return createHash("sha256").update(normalizeCalendarId(calendarId), "utf8").digest("hex");
}

async function seed() {
    console.log(`=== 캘린더 바인딩 시딩 시작 ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    const snap = await db.collection("vehicles").get();

    // 캘린더 ID → 그 ID를 쓰는 기관 집합 (충돌 판별용)
    const owners = new Map<string, { normalized: string; orgIds: Set<string>; vehicleIds: string[] }>();

    for (const doc of snap.docs) {
        const data = doc.data();
        const raw = data.googleCalendarId as string | undefined;
        const orgId = data.organizationId as string | undefined;
        // 동기화가 요구하는 최소 형식(@ 포함)을 만족하지 않는 값은 애초에 쓰이지 않는다
        if (!raw || !raw.includes("@") || !orgId) continue;

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

    console.log(`캘린더를 쓰는 차량이 가리키는 고유 캘린더: ${owners.size}개`);
    console.log(`  ${isDryRun ? "등록 예정" : "등록"}: ${created}개`);
    console.log(`  이미 등록됨(스킵): ${alreadyBound}개`);
    if (conflicts.length > 0) {
        console.log(`\n확인 필요 (등록하지 않음) — ${conflicts.length}건:`);
        conflicts.forEach((c) => console.log(c));
        console.log(`\n한 캘린더를 둘 이상의 기관이 가리키고 있습니다. 정당한 소유 기관을 확인한 뒤`);
        console.log(`calendarBindings 문서를 직접 만들고, 잘못 등록된 차량의 캘린더 ID를 비워주세요.`);
    }
    console.log(`\n=== 시딩 완료 ===`);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
