/**
 * 복구 스크립트: 수정 화면의 '직후 기록' 오조회로 출발 km가 덮어써진 운행일지 되돌리기
 *
 * 배경: `getAdjacentDriveLogs`가 직후 기록을 잘못 골라(뒤 기록이 10건을 넘으면 끝에서
 *       10번째), 지난 기록을 수정해 저장하면 엉뚱한 최근 기록의 출발 km가 그 기록의 도착 km로
 *       덮어써졌다. 목적지만 고쳐도 일어났고, 피해 기록의 주행거리가 수백 km씩 늘었다
 *       (2026-11-03 궁동종합사회복지관 문의). 조회는 고쳤고, 이미 덮어써진 기록은 여기서 되돌린다.
 *
 * 판별·되돌릴 값의 근거는 scripts/lib/misadjustedNextLogs.ts 주석 참고.
 * 요약하면 피해 기록은 `distance`가 원래 거리 그대로 남아 있어 **원래 출발 = 도착 − distance**다.
 *
 *   - 기본은 **조회만** 한다(쓰려면 `--apply`).
 *   - `--apply`는 **기관을 지정해야** 한다(`--org`).
 *   - 확신도 'manual'(되돌려도 앞 기록과 겹침)은 목록에만 올리고 쓰지 않는다.
 *   - 쓰기 전 원래 값을 `scripts/.backups/`에 남기고, `--undo <백업 파일>`로 되돌린다.
 *
 * 쓰기는 `onDriveLogUpdated` 트리거를 깨운다. 출발 km만 바뀌므로 km 연쇄 재정합은 돌지 않고,
 * 기관 통계(총 주행거리)가 그 차이만큼 줄어 함께 바로잡힌다.
 *
 * 사용법:
 *   npx tsx scripts/repairMisadjustedNextLogs.ts                          # 전 기관 조회 (변경 없음)
 *   npx tsx scripts/repairMisadjustedNextLogs.ts --org <기관ID>            # 한 기관 조회
 *   npx tsx scripts/repairMisadjustedNextLogs.ts --org <기관ID> --apply    # 되돌리기
 *   npx tsx scripts/repairMisadjustedNextLogs.ts --undo <백업 파일>         # 되돌린 것을 다시 원래대로
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로 (없으면 ADC)
 */
import { getFirestore, type Query } from "firebase-admin/firestore";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { initAdminApp } from "./lib/adminApp";
import { findMisadjustedNextLogs, isAutoRepairable, type MisadjustedLog } from "./lib/misadjustedNextLogs";

const argValue = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
const isApply = process.argv.includes("--apply");
const onlyOrgId = argValue("--org");
const undoFile = argValue("--undo");

if (isApply && !onlyOrgId) {
    console.error("❌ --apply는 --org <기관ID>와 함께 써야 합니다 (전 기관 일괄 실행은 받지 않습니다).");
    process.exit(1);
}

const app = initAdminApp();
const db = getFirestore(app);

const backupDir = resolve(dirname(fileURLToPath(import.meta.url)), ".backups");

interface BackupEntry { id: string; fromStartKm: number; toStartKm: number }

const toMs = (v: unknown): number => {
    if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
    if (v instanceof Date) return v.getTime();
    return NaN;
};

const kst = (ms: number) =>
    new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

async function nameOf(col: string, id: string, fields: string[]): Promise<string> {
    const snap = await db.collection(col).doc(id).get();
    const data = snap.data() ?? {};
    for (const f of fields) if (typeof data[f] === "string" && data[f]) return data[f] as string;
    return id;
}

async function undo(file: string) {
    const entries = JSON.parse(readFileSync(file, "utf-8")) as BackupEntry[];
    console.log(`=== 되돌리기: ${entries.length}건 (${file}) ===`);
    let restored = 0;
    let skipped = 0;
    for (const e of entries) {
        const ref = db.collection("driveLogs").doc(e.id);
        const cur = (await ref.get()).data();
        // 복구 뒤 다른 수정이 있었으면 덮지 않는다
        if (!cur || cur.startKm !== e.toStartKm) {
            console.log(`  건너뜀 ${e.id}: 지금 출발 km ${cur?.startKm ?? "(문서 없음)"} ≠ 복구값 ${e.toStartKm}`);
            skipped++;
            continue;
        }
        await ref.update({ startKm: e.fromStartKm });
        restored++;
    }
    console.log(`원래대로: ${restored}건, 건너뜀: ${skipped}건`);
}

async function scan() {
    console.log(`=== 덮어써진 출발 km 찾기 (${isApply ? "되돌리기" : "조회만 — 쓰려면 --org와 --apply"}) ===`);
    if (onlyOrgId) console.log(`대상 기관: ${onlyOrgId}`);
    console.log("");

    let query: Query = db.collection("driveLogs");
    if (onlyOrgId) query = query.where("organizationId", "==", onlyOrgId);
    // 판별에 쓰는 필드만 받는다(읽기 건수는 같지만 전송량이 준다)
    const snap = await query
        .select("organizationId", "vehicleId", "timestamp", "startKm", "endKm", "distance", "editedAt", "driverName")
        .get();

    // 기관·차량별로 묶는다 — 인접 관계는 같은 기관의 같은 차량 안에서만 뜻이 있다
    const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.organizationId || !d.vehicleId) continue;
        const key = `${d.organizationId}\u0000${d.vehicleId}`;
        const list = groups.get(key);
        if (list) list.push(doc); else groups.set(key, [doc]);
    }

    const byOrg = new Map<string, Array<MisadjustedLog & { vehicleId: string; driverName: string }>>();
    for (const [key, docs] of groups) {
        const [orgId, vehicleId] = key.split("\u0000");
        const found = findMisadjustedNextLogs(docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                timestampMs: toMs(d.timestamp),
                startKm: d.startKm,
                endKm: d.endKm,
                distance: d.distance,
                edited: d.editedAt != null,
            };
        }).filter(r => Number.isFinite(r.timestampMs)));
        if (found.length === 0) continue;
        const driverOf = new Map(docs.map(doc => [doc.id, String(doc.data().driverName ?? "")]));
        const list = byOrg.get(orgId) ?? [];
        list.push(...found.map(f => ({ ...f, vehicleId, driverName: driverOf.get(f.id) ?? "" })));
        byOrg.set(orgId, list);
    }

    console.log(`조회한 운행일지: ${snap.size}건`);
    if (byOrg.size === 0) {
        console.log("덮어써진 것으로 보이는 기록이 없습니다.");
        return;
    }

    const toApply: BackupEntry[] = [];
    for (const [orgId, logs] of byOrg) {
        const orgName = await nameOf("organizations", orgId, ["name"]);
        const total = logs.reduce((s, l) => s + l.inflatedKm, 0);
        console.log(`\n■ ${orgName} (${orgId}) — ${logs.length}건, 늘어난 거리 합계 ${total.toLocaleString()} km`);
        const vehicleNames = new Map<string, string>();
        for (const l of logs.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.timestampMs - b.timestampMs)) {
            if (!vehicleNames.has(l.vehicleId)) {
                vehicleNames.set(l.vehicleId, await nameOf("vehicles", l.vehicleId, ["displayName", "name", "plateNumber"]));
            }
            const label = l.confidence === "exact" ? "앞 기록과 이어짐" : l.confidence === "gap" ? "앞 기록과 빈 구간" : "확인 필요(자동 복구 안 함)";
            console.log(
                `  ${vehicleNames.get(l.vehicleId)} · ${kst(l.timestampMs)} · ${l.driverName || "-"}\n` +
                `    출발 ${l.startKm.toLocaleString()} → ${l.restoredStartKm.toLocaleString()} ` +
                `(도착 ${l.endKm.toLocaleString()}, 거리 ${(l.endKm - l.startKm).toLocaleString()} → ${l.distance.toLocaleString()} km, ` +
                `앞 기록 도착 ${l.prevEndKm.toLocaleString()}) [${label}] id=${l.id}`,
            );
            if (isAutoRepairable(l)) toApply.push({ id: l.id, fromStartKm: l.startKm, toStartKm: l.restoredStartKm });
        }
    }

    if (!isApply) {
        console.log(`\n자동 복구 대상: ${toApply.length}건. 되돌리려면 --org <기관ID> --apply로 다시 실행하세요.`);
        return;
    }

    if (toApply.length === 0) {
        console.log("\n자동 복구 대상이 없습니다.");
        return;
    }

    mkdirSync(backupDir, { recursive: true });
    const backupFile = resolve(backupDir, `repairMisadjustedNextLogs-${onlyOrgId}-${Date.now()}.json`);
    writeFileSync(backupFile, JSON.stringify(toApply, null, 2));
    console.log(`\n백업: ${backupFile}`);

    // 한 건씩 쓴다 — 건수가 적고, 각 쓰기가 트리거를 깨우므로 몰아 보내지 않는다
    let done = 0;
    for (const e of toApply) {
        await db.collection("driveLogs").doc(e.id).update({ startKm: e.toStartKm });
        done++;
    }
    console.log(`되돌림: ${done}건. 잘못됐다면 --undo ${backupFile}`);
}

(undoFile ? undo(undoFile) : scan()).catch((err) => {
    console.error(err);
    process.exit(1);
});
