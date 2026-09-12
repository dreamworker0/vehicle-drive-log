/**
 * 백필 스크립트: 하이패스 카드에 **검산 기준점**을 박는다 (일회성)
 *
 * ## 왜 필요한가 — 그리고 왜 지금뿐인가
 *
 * 2026-09-12부터 카드 잔액은 서버 트리거가 **증분으로** 굴린다(Phase 227). 증분 회계는
 * 한 번 어긋나면 스스로 복구되지 않는데, 기준점이 없으면 **어긋났다는 사실조차 알 수 없다** —
 * "지금 잔액이 맞는가"를 물으려면 무엇으로부터 얼마가 오갔는지를 알아야 하기 때문이다.
 *
 * 기준점은 "그 시점의 잔액"이라 **지나가면 복원할 수 없다.** 오늘 박아 두면 그 이후로는
 * 영원히 대조할 수 있고, 안 박으면 영원히 못 한다. 그래서 배포와 함께 한 번 돌린다.
 *
 * 새로 만드는 카드는 `createHipassCard`가 등록 시점에 스스로 박으므로 대상이 아니다.
 * 사람이 [하이패스 관리]에서 잔액을 손으로 고치면 그 값이 새 기준점이 된다
 * (`updateHipassCard`). 이 스크립트는 **그 이전부터 있던 카드**만 채운다.
 *
 * ## 무엇을 쓰는가
 *
 *   balanceBaseline = 지금 잔액        baselineAt = 지금
 *
 * 지금 잔액이 실물과 맞는지는 **모른다.** 이 스크립트가 보장하는 것은 "오늘 이후의 변화는
 * 추적 가능하다"뿐이다. 오늘 이전의 오차는 실물 카드를 보고 [하이패스 관리]에서 맞추면
 * 그때 기준점도 함께 갱신된다.
 *
 * 사용법 (프로젝트 루트, Node 22):
 *   npx tsx scripts/backfillHipassBalanceBaseline.ts --dry-run   # 대상만 집계
 *   npx tsx scripts/backfillHipassBalanceBaseline.ts             # 실제 실행
 *
 * 실행 전 Google 인증(ADC)이 필요하다:
 *   gcloud auth application-default login
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initAdminApp } from "./lib/adminApp";

const isDryRun = process.argv.includes("--dry-run");

// 자격증명과 대상 프로젝트 고정은 lib/adminApp이 맡는다.
const app = initAdminApp();
const db = getFirestore(app);

/** Firestore 배치 상한(500) 안쪽 */
const BATCH_SIZE = 400;

async function backfill(): Promise<void> {
    console.log(`=== 하이패스 검산 기준점 백필 ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    const snap = await db.collection("hipassCards").get();
    if (snap.empty) {
        console.log("하이패스 카드가 없습니다. 할 일 없음.");
        return;
    }

    // 이미 기준점이 있는 카드는 건드리지 않는다 — 다시 돌려도 안전해야 한다(멱등).
    // 덮어쓰면 그 사이의 정상 증분이 통째로 '검산 완료' 처리되어 오차가 묻힌다.
    const targets = snap.docs.filter((d) => d.data().balanceBaseline === undefined);

    console.log(`전체 카드: ${snap.size}건`);
    console.log(`기준점 없음(대상): ${targets.length}건`);
    console.log(`이미 있음(건너뜀): ${snap.size - targets.length}건\n`);

    if (targets.length === 0) return;

    // 잔액이 숫자가 아닌 문서는 기준점을 0으로 박지 않고 남긴다 — 0으로 박으면 그 카드의
    // 이후 대조가 전부 어긋난 채 '정상'으로 보인다. 사람이 먼저 잔액을 바로잡아야 한다.
    const broken = targets.filter((d) => typeof d.data().balance !== "number");
    if (broken.length > 0) {
        console.warn(`⚠️ 잔액이 숫자가 아닌 카드 ${broken.length}건은 건너뜁니다 — 먼저 [하이패스 관리]에서 잔액을 확인하세요:`);
        broken.forEach((d) => console.warn(`   ${d.id} (org=${d.data().organizationId}, balance=${JSON.stringify(d.data().balance)})`));
        console.warn("");
    }

    const writable = targets.filter((d) => typeof d.data().balance === "number");
    if (isDryRun) {
        console.log(`DRY-RUN: ${writable.length}건에 기준점을 박을 예정입니다.`);
        return;
    }

    let done = 0;
    for (let i = 0; i < writable.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const d of writable.slice(i, i + BATCH_SIZE)) {
            batch.update(d.ref, {
                balanceBaseline: d.data().balance,
                baselineAt: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        done += Math.min(BATCH_SIZE, writable.length - i);
        console.log(`  ${done}/${writable.length} 완료`);
    }

    console.log(`\n✅ 기준점 ${done}건 기록 완료.`);
    console.log("   이제 npx tsx scripts/check-hipass-balance-drift.ts 로 언제든 대조할 수 있습니다.");
}

backfill()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("백필 실패:", err);
        process.exit(1);
    });
