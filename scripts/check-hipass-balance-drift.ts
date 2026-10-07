/**
 * check-hipass-balance-drift — 하이패스 카드 잔액이 기록과 맞는지 대조 (읽기 전용)
 *
 * ## 무엇을 검산하는가
 *
 * 잔액은 서버 트리거가 증분으로 굴린다(Phase 227). 증분 회계는 한 번 어긋나면 스스로
 * 복구되지 않으므로, 어긋났는지를 **밖에서 물어볼 수단**이 있어야 한다. 그 계산이 이것이다:
 *
 *   기대 잔액 = balanceBaseline
 *             + Σ(baselineAt 이후 충전 기록의 chargeAmount)
 *             − Σ(baselineAt 이후 운행일지의 hipassBalanceBefore − hipassBalanceAfter)
 *
 * 차량 누적 km에는 `verifyMileageConsistency`가 있는데 잔액에는 대응물이 없었다.
 * 이 스크립트가 그 자리를 채운다. **고치지는 않는다** — 차이의 원인이 트리거 누락인지
 * 사람이 실물과 맞춘 것인지는 기록만 보고 판정할 수 없고, 자동 보정은 오히려 위험하다.
 *
 * ## 차이가 났을 때 흔한 원인
 *
 *  - 카드가 한 차량에 둘 이상 연결돼 있어 트리거가 반영을 건너뜀 (서버 로그에 WARNING)
 *  - 같은 카드를 두 사람이 동시에 써서 '사용 전 잔액' 기준값이 겹침
 *  - 잔액이 0에서 잘림(`Math.max(0, …)`) — 실물보다 적게 남은 상태
 *  - 트리거 실행 실패 (Sentry에 "하이패스 잔액 반영 실패")
 *
 * 사용법 (프로젝트 루트, Node 22):
 *   npx tsx scripts/check-hipass-balance-drift.ts
 *   npx tsx scripts/check-hipass-balance-drift.ts --org=<organizationId>
 *   npx tsx scripts/check-hipass-balance-drift.ts --csv=drift.csv
 *
 * 실행 전 Google 인증(ADC)이 필요하다:
 *   gcloud auth application-default login
 */
import { writeFileSync } from "node:fs";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initAdminApp } from "./lib/adminApp";

const app = initAdminApp({ quiet: true });
const db = getFirestore(app);

const args = process.argv.slice(2);
const orgFilter = args.find((a) => a.startsWith("--org="))?.split("=")[1];
const csvPath = args.find((a) => a.startsWith("--csv="))?.split("=")[1];

/** 1원 단위까지 맞아야 한다 — 잔액은 정수로만 오간다 */
const TOLERANCE = 0;

interface Row {
    org: string;
    cardId: string;
    cardNumber: string;
    vehicleId: string;
    baseline: number;
    charges: number;
    usages: number;
    expected: number;
    actual: number;
    diff: number;
}

function toDate(v: unknown): Date | null {
    if (v instanceof Timestamp) return v.toDate();
    if (v instanceof Date) return v;
    return null;
}

/** 운행일지 한 건의 하이패스 사용액 — 서버 트리거(usedAmountOf)와 같은 규칙 */
function usedAmountOf(d: FirebaseFirestore.DocumentData): number {
    const before = d.hipassBalanceBefore;
    const after = d.hipassBalanceAfter;
    if (typeof before !== "number" || typeof after !== "number") return 0;
    const used = before - after;
    return Number.isFinite(used) && used > 0 ? used : 0;
}

async function run(): Promise<void> {
    console.log("=== 하이패스 잔액 대조 (읽기 전용) ===\n");

    let cardQuery: FirebaseFirestore.Query = db.collection("hipassCards");
    if (orgFilter) cardQuery = cardQuery.where("organizationId", "==", orgFilter);
    const cards = await cardQuery.get();

    if (cards.empty) {
        console.log("대상 카드가 없습니다.");
        return;
    }

    const rows: Row[] = [];
    let noBaseline = 0;

    for (const card of cards.docs) {
        const c = card.data();
        const baselineAt = toDate(c.baselineAt);
        if (typeof c.balanceBaseline !== "number" || !baselineAt) {
            // 기준점이 없으면 대조할 수 없다. backfill 스크립트를 먼저 돌려야 한다.
            noBaseline += 1;
            continue;
        }

        const org = c.organizationId as string;

        // 기준점 이후의 충전 — 기록의 시각은 createdAt을 쓴다(date는 사용자가 고르는 값이라
        // 기준점과 같은 시간축이 아니다).
        //
        // **시각 필터는 Firestore가 아니라 여기서 건다.** 동등 두 개(org·card)에 범위 하나를
        // 더하면 `(cardId, organizationId, createdAt ASC)` 복합 인덱스가 필요한데, 기존 인덱스는
        // `createdAt DESC`라 받지 못한다(실행해서 확인했다 — code 9 "query requires an index").
        // 한 카드의 충전 기록은 많아야 월 몇 건이라 전부 읽어도 부담이 없고, 검산 하나 때문에
        // 인덱스를 늘리는 것보다 낫다. 기관·카드 필터는 그대로 남긴다(절대규칙 #1).
        const charges = await db.collection("hipassCharges")
            .where("organizationId", "==", org)
            .where("cardId", "==", card.id)
            .get();
        const chargeSum = charges.docs.reduce((sum, d) => {
            const createdAt = toDate(d.data().createdAt);
            if (!createdAt || createdAt <= baselineAt) return sum;
            return sum + (typeof d.data().chargeAmount === "number" ? d.data().chargeAmount : 0);
        }, 0);

        // 기준점 이후의 사용 — 트리거가 카드를 찾는 규칙과 같게 기관+차량으로 모은다.
        const logs = await db.collection("driveLogs")
            .where("organizationId", "==", org)
            .where("vehicleId", "==", c.vehicleId)
            .where("timestamp", ">", baselineAt)
            .get();
        const usageSum = logs.docs.reduce((sum, d) => sum + usedAmountOf(d.data()), 0);

        const expected = Math.max(0, c.balanceBaseline + chargeSum - usageSum);
        const actual = typeof c.balance === "number" ? c.balance : 0;
        const diff = actual - expected;

        if (Math.abs(diff) > TOLERANCE) {
            rows.push({
                org, cardId: card.id,
                cardNumber: (c.cardNumber as string) ?? "",
                vehicleId: (c.vehicleId as string) ?? "",
                baseline: c.balanceBaseline, charges: chargeSum, usages: usageSum,
                expected, actual, diff,
            });
        }
    }

    console.log(`대조한 카드: ${cards.size - noBaseline}건`);
    if (noBaseline > 0) {
        console.log(`기준점 없음(대조 불가): ${noBaseline}건 — npx tsx scripts/backfillHipassBalanceBaseline.ts 를 먼저 실행하세요.`);
    }

    if (rows.length === 0) {
        console.log("\n✅ 어긋난 카드가 없습니다.");
        return;
    }

    console.log(`\n⚠️ 어긋난 카드 ${rows.length}건\n`);
    rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    for (const r of rows) {
        const sign = r.diff > 0 ? "+" : "−";
        console.log(`  [${r.org}] ${r.cardNumber || r.cardId} (차량 ${r.vehicleId})`);
        console.log(`     기준 ${r.baseline.toLocaleString()} + 충전 ${r.charges.toLocaleString()} − 사용 ${r.usages.toLocaleString()} = 기대 ${r.expected.toLocaleString()}`);
        console.log(`     실제 ${r.actual.toLocaleString()}  →  차이 ${sign}${Math.abs(r.diff).toLocaleString()}원\n`);
    }

    console.log("차이의 원인은 기록만으로 판정되지 않습니다 — 파일 머리말의 '흔한 원인'을 참고하고,");
    console.log("실물 카드를 확인한 뒤 [하이패스 관리]에서 맞추면 그 값이 새 기준점이 됩니다.");

    if (csvPath) {
        const header = "organizationId,cardId,cardNumber,vehicleId,baseline,charges,usages,expected,actual,diff\n";
        const body = rows.map((r) =>
            [r.org, r.cardId, r.cardNumber, r.vehicleId, r.baseline, r.charges, r.usages, r.expected, r.actual, r.diff].join(","),
        ).join("\n");
        writeFileSync(csvPath, header + body, "utf8");
        console.log(`\nCSV 저장: ${csvPath}`);
    }
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("대조 실패:", err);
        process.exit(1);
    });
