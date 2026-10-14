/**
 * 기관 문서 없이 남은 기관 데이터(고아)를 찾아 파기하는 일회성 스크립트
 *
 * ## 왜 필요한가
 * 2026-10-14 이전의 기관 퍼지(주간 배치 purgeOrgs·superAdmin [영구 삭제])는 users와 기관 문서만
 * 지웠다. 그 기관의 운행일지·예약·차량·주유·정비·알림·연동·월별 통계·증빙 이미지는 기관 문서 없이
 * 남았고, 기관 문서가 없으니 새 파기 로직(#474)도 그 기관을 찾지 못한다. 처리방침 제9조가 약속한
 * 파기를 과거 기관에도 적용하려고 한 번 돌린다. 앞으로 생기는 해지 기관은 주간 배치가 처리한다.
 *
 * ## 사용법 (저장소 루트에서 — firebase-admin은 functions/node_modules에서 읽는다)
 *   cd functions            (Windows PowerShell 5.1은 `&&`를 지원하지 않는다 — 한 줄씩 또는 `;`로 잇는다)
 *   npx tsx ../scripts/purge-orphan-org-data.ts                 # 1단계: 대상만 집계 (기본, 아무것도 지우지 않음)
 *   npx tsx ../scripts/purge-orphan-org-data.ts --execute       # 2단계: 위 목록 전부 파기
 *   npx tsx ../scripts/purge-orphan-org-data.ts --execute --only=<기관ID>   # 한 기관만 파기
 *
 * ## 안전장치
 * - 기본이 dry-run이다. `--execute` 없이는 쓰기를 하지 않는다.
 * - 대상 프로젝트는 lib/adminApp이 고정하고 첫 줄에 출력한다 — 프로젝트를 반드시 확인한다.
 * - 고아 판정 = 데이터에 기관 ID가 있는데 `organizations/{id}` 문서가 없음. 파기 중에도 단계마다
 *   기관 문서가 여전히 없는지 다시 확인한다(purgeOrphanOrganizationData).
 * - 기관 필드가 비었거나 `__system__`인 문서는 대상이 아니다.
 * - 접속기록(auditLogs)은 지우지 않는다(1년 법정 보관, TTL 자동 파기). 삭제 트리거는 기관 문서가
 *   없으면 환불·km 보정·캘린더 일정 삭제를 건너뛴다(isOrgRetired).
 *
 * ## 비용
 * 탐색은 서로 다른 기관 ID만 건너뛰며 훑어 (컬렉션 수 × 기관 수) 읽기, 집계는 count라 1,000건당
 * 1회다. 파기는 지우는 문서 수만큼 쓰기 + 삭제 트리거 실행이 생긴다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { initAdminApp, resolveProjectId } from "./lib/adminApp";
import {
    findOrphanOrgIds,
    countOrgData,
    purgeOrphanOrganizationData,
} from "../functions/src/services/organization/purgeOrganizationData";

initAdminApp();

const execute = process.argv.includes("--execute");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

/** 기본 Storage 버킷 — 증빙 이미지(organizations/{id}/)가 있는 곳. 백업 전용 버킷이 아니다 */
function defaultBucketName(): string {
    const fromEnv = process.env.STORAGE_BUCKET;
    if (fromEnv) return fromEnv;
    const projectId = resolveProjectId();
    if (!projectId) throw new Error("프로젝트 ID를 알 수 없다 — GOOGLE_CLOUD_PROJECT 또는 .firebaserc를 확인");
    return `${projectId}.firebasestorage.app`;
}

async function main() {
    const db = getFirestore();
    console.log(execute ? "🗑️  실행 모드 — 고아 데이터를 파기합니다" : "🔎 확인 모드(dry-run) — 아무것도 지우지 않습니다");

    console.log("\n기관 ID를 훑는 중…");
    const orphans = await findOrphanOrgIds(db, (message) => console.log(message));
    const targets = only ? orphans.filter((id) => id === only) : orphans;

    if (only && targets.length === 0) {
        console.log(`\n--only=${only}: 고아 기관이 아닙니다(기관 문서가 있거나 남은 데이터가 없음). 중단합니다.`);
        return;
    }
    if (targets.length === 0) {
        console.log("\n✅ 기관 문서 없이 남은 데이터가 없습니다.");
        return;
    }

    console.log(`\n고아 기관 ${targets.length}곳 (organizations/* = 기관 하위 컬렉션, orgStats* = 월별 통계):`);
    // 기관별 집계를 몇 곳씩 동시에 — 하나씩 세면 기관당 수 초씩 걸렸다
    const CONCURRENCY = 5;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const chunk = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map((orgId) => countOrgData(orgId, db)));
        chunk.forEach((orgId, j) => {
            const counts = results[j];
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            console.log(`  - ${orgId}: ${total}건 ${JSON.stringify(counts)}`);
        });
    }

    if (!execute) {
        console.log("\n위 목록을 확인한 뒤 --execute를 붙여 다시 실행하면 파기합니다(한 기관만: --only=<기관ID>).");
        return;
    }

    const bucket = getStorage().bucket(defaultBucketName());
    console.log(`\nStorage 버킷: ${bucket.name}`);
    let ok = 0;
    let failed = 0;
    for (const orgId of targets) {
        try {
            const summary = await purgeOrphanOrganizationData(orgId, bucket, db);
            console.log(`  ✅ ${orgId}: ${JSON.stringify(summary.deleted)}`);
            ok++;
        } catch (err) {
            // 한 기관이 실패해도 나머지는 진행한다 — 다시 실행하면 남은 것부터 이어서 지운다(멱등).
            console.error(`  ❌ ${orgId}: ${(err as Error).message}`);
            failed++;
        }
    }
    console.log(`\n📊 결과: 파기 ${ok}곳, 실패 ${failed}곳${failed > 0 ? " — 다시 실행하면 이어서 지웁니다" : ""}`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error("❌ 중단:", err);
    process.exitCode = 1;
});
