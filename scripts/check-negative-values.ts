/**
 * check-negative-values — 음수가 저장된 기록 점검 (읽기 전용 운영 스크립트)
 *
 * 입력 폼이 음수를 막기 전(2026-08-08 배포)에 저장된 기록에는 마이너스 값이 남아 있다.
 * 이 스크립트는 그 기록을 기관별로 찾아 나열한다. **고치지는 않는다** — `-13`이 `13`의
 * 오타인지 애초에 버려야 할 기록인지는 사람만 판단할 수 있어서, 자동 보정은 오히려 위험하다.
 *
 * 특히 중요한 건 하이패스다. 운행일지의 `hipassBalanceAfter`가 음수면 저장 시
 * `increment(-(사용전 - 사용후))`로 실제 통행료보다 딱 그 절댓값만큼 더 차감됐다.
 * 그래서 카드별 과차감 합계를 따로 계산해 준다 — 그 금액만큼 잔액을 올려주면 된다.
 *
 * 사용법 (프로젝트 루트에서, Node 22):
 *   npx tsx scripts/check-negative-values.ts
 *   npx tsx scripts/check-negative-values.ts --org=<organizationId>
 *   npx tsx scripts/check-negative-values.ts --csv=negatives.csv
 *
 * 실행 전 Google 인증(ADC)이 필요하다. 둘 중 하나:
 *   gcloud auth application-default login          ← 키 파일이 남지 않아 이쪽을 권장
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<서비스계정.json 경로>"   (PowerShell)
 * 인증이 없으면 실행 시 설정 방법을 안내하고 중단한다.
 */
import { writeFileSync } from 'node:fs';
import { getFirestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { initAdminApp, resolveProjectId } from './lib/adminApp';

// 대상 프로젝트 고정의 근거는 lib/adminApp.ts에 있다.
// projectId는 아래 오류 안내에서 쓴다.
const projectId = resolveProjectId();
initAdminApp({ quiet: true });
const db = getFirestore();

const args = process.argv.slice(2);
const orgFilter = args.find((a) => a.startsWith('--org='))?.split('=')[1];
const csvPath = args.find((a) => a.startsWith('--csv='))?.split('=')[1];

/** 한 번에 읽어올 문서 수 — 기관 수만큼 반복하므로 메모리를 넘기지 않게 페이지 단위로 끊는다 */
const PAGE_SIZE = 500;

interface FieldSpec {
    /** Firestore 필드명 */
    key: string;
    /** 사람이 읽는 이름 (리포트 출력용) */
    label: string;
}

interface CollectionSpec {
    collection: string;
    /** 화면에서 부르는 이름 */
    label: string;
    fields: FieldSpec[];
    /** 리포트에 곁들일 한 줄 맥락 (날짜·차량 등) */
    context: (data: Record<string, unknown>) => string;
}

/** 점검 대상 — 음수가 될 수 없는 숫자 필드만 모았다. 기관 좌표(위도·경도)는 음수가 정상이라 제외. */
const TARGETS: CollectionSpec[] = [
    {
        collection: 'driveLogs',
        label: '운행일지',
        fields: [
            { key: 'startKm', label: '출발 km' },
            { key: 'endKm', label: '도착 km' },
            { key: 'distance', label: '주행거리' },
            { key: 'batteryStart', label: '출발 배터리 %' },
            { key: 'batteryEnd', label: '도착 배터리 %' },
            { key: 'hipassBalanceBefore', label: '하이패스 사용전' },
            { key: 'hipassBalanceAfter', label: '하이패스 사용후' },
        ],
        context: (d) => `${d.date ?? toDateStr(d.timestamp)} · ${d.vehicleName ?? '?'} · ${d.driverName ?? '?'}`,
    },
    {
        collection: 'fuelLogs',
        label: '주유·충전 기록',
        fields: [
            { key: 'meterReading', label: '주유미터' },
            { key: 'fuelAmount', label: '주유량' },
            { key: 'fuelCost', label: '주유금액' },
        ],
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.driverName ?? '?'}`,
    },
    {
        collection: 'maintenanceRecords',
        label: '정비 기록',
        fields: [
            { key: 'cost', label: '비용' },
            { key: 'km', label: '현재 km' },
            { key: 'nextDueKm', label: '다음 정비 km' },
        ],
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.type ?? '?'}`,
    },
    {
        collection: 'hipassCharges',
        label: '하이패스 충전 기록',
        fields: [
            { key: 'chargeAmount', label: '충전금액' },
            { key: 'balanceBefore', label: '충전 전 잔액' },
            { key: 'balanceAfter', label: '충전 후 잔액' },
        ],
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.chargerName ?? '?'}`,
    },
    {
        collection: 'hipassCards',
        label: '하이패스 카드',
        fields: [{ key: 'balance', label: '현재 잔액' }],
        context: (d) => `${d.cardNumber ?? '?'} · ${d.vehicleName ?? '?'}`,
    },
    {
        collection: 'vehicles',
        label: '차량',
        fields: [
            { key: 'currentKm', label: '현재 누적 km' },
            { key: 'currentBattery', label: '배터리 잔량 %' },
        ],
        context: (d) => `${d.displayName ?? d.name ?? '?'} · ${d.plateNumber ?? '?'}`,
    },
];

interface Finding {
    organizationId: string;
    collection: string;
    collectionLabel: string;
    docId: string;
    field: string;
    fieldLabel: string;
    value: number;
    /** NaN처럼 음수는 아니지만 숫자로 쓸 수 없는 값 */
    kind: 'negative' | 'nan';
    context: string;
}

/** Firestore Timestamp/Date → YYYY-MM-DD (실패 시 '?') */
function toDateStr(ts: unknown): string {
    if (!ts) return '?';
    const d =
        typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function'
            ? (ts as { toDate: () => Date }).toDate()
            : new Date(ts as string | number);
    return Number.isNaN(d.getTime()) ? '?' : d.toISOString().slice(0, 10);
}

/** 전체 컬렉션에서 읽은 문서 수 — 0이면 엉뚱한 곳을 본 것이라 "이상 없음"으로 단정하면 안 된다 */
let totalScanned = 0;

/** 컬렉션 하나를 페이지 단위로 훑어 음수·NaN 필드를 모은다 */
async function scan(spec: CollectionSpec): Promise<Finding[]> {
    const findings: Finding[] = [];
    let last: QueryDocumentSnapshot | null = null;
    let scanned = 0;

    for (;;) {
        let q: Query = db.collection(spec.collection);
        if (orgFilter) q = q.where('organizationId', '==', orgFilter);
        q = q.orderBy('__name__').limit(PAGE_SIZE);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            const data = doc.data();
            for (const f of spec.fields) {
                const v = data[f.key];
                if (typeof v !== 'number') continue;
                const kind = Number.isNaN(v) ? 'nan' : v < 0 ? 'negative' : null;
                if (!kind) continue;
                findings.push({
                    organizationId: (data.organizationId as string) || '(기관 없음)',
                    collection: spec.collection,
                    collectionLabel: spec.label,
                    docId: doc.id,
                    field: f.key,
                    fieldLabel: f.label,
                    value: v,
                    kind,
                    context: spec.context(data),
                });
            }
        }

        scanned += snap.docs.length;
        totalScanned += snap.docs.length;
        last = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) break;
    }

    // 한 문서에 잘못된 필드가 여럿일 수 있어 "문서 수"와 "문제 필드 수"를 나눠 적는다
    console.log(`  ${spec.label.padEnd(16)} 문서 ${String(scanned).padStart(6)}건 → 문제 필드 ${findings.length}건`);
    return findings;
}

/** organizationId → 기관명 (없으면 id 그대로) */
async function loadOrgNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(
        ids.map(async (id) => {
            if (id === '(기관 없음)') return;
            try {
                const snap = await db.collection('organizations').doc(id).get();
                if (snap.exists) names.set(id, (snap.data()?.name as string) || id);
            } catch {
                /* 기관 문서를 못 읽어도 점검 결과는 그대로 낸다 */
            }
        })
    );
    return names;
}

/**
 * 하이패스 과차감 계산.
 *
 * 운행일지 저장은 `increment(-(카드잔액 - 사용후금액))`을 쓴다. 사용후 금액이 음수면
 * 그 절댓값만큼 실제보다 더 빠져나갔다 — 카드별로 합산하면 되돌려야 할 금액이 나온다.
 */
function summarizeHipassOverDeduction(findings: Finding[]): Map<string, number> {
    const perOrg = new Map<string, number>();
    for (const f of findings) {
        if (f.collection !== 'driveLogs' || f.field !== 'hipassBalanceAfter' || f.kind !== 'negative') continue;
        perOrg.set(f.organizationId, (perOrg.get(f.organizationId) ?? 0) + Math.abs(f.value));
    }
    return perOrg;
}

function toCsv(findings: Finding[], orgNames: Map<string, string>): string {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ['기관ID', '기관명', '컬렉션', '항목', '문서ID', '필드', '값', '맥락'].join(',');
    const rows = findings.map((f) =>
        [
            esc(f.organizationId),
            esc(orgNames.get(f.organizationId) ?? ''),
            esc(f.collection),
            esc(f.collectionLabel),
            esc(f.docId),
            esc(f.fieldLabel),
            f.value,
            esc(f.context),
        ].join(',')
    );
    return [header, ...rows].join('\n');
}

async function main() {
    console.log('\n=== 음수 저장 기록 점검 (읽기 전용) ===');
    if (orgFilter) console.log(`기관 한정: ${orgFilter}`);
    console.log('');

    const findings: Finding[] = [];
    for (const spec of TARGETS) {
        findings.push(...(await scan(spec)));
    }

    // 문서를 한 건도 못 읽었다면 데이터가 깨끗한 게 아니라 **엉뚱한 곳을 본 것**이다.
    // 실제로 ADC의 기본 프로젝트(다른 프로젝트)를 조회해 에러 없이 0건이 나온 적이 있다 —
    // 그때 "✅ 이상 없음"을 띄우면 점검을 마쳤다고 믿게 되므로 반드시 경고로 끊는다.
    if (totalScanned === 0) {
        console.error('\n⚠️  문서를 한 건도 읽지 못했습니다 — 점검이 이루어지지 않았습니다.\n');
        console.error(`조회한 프로젝트: ${projectId ?? '(미지정)'}`);
        if (orgFilter) console.error(`기관 한정: ${orgFilter}  ← 이 기관 ID가 맞는지 확인하세요`);
        console.error('\n확인할 것:');
        console.error('  1. 프로젝트가 맞는지 — 운영 데이터는 vehicle-drive-log에 있습니다.');
        console.error('     PowerShell:  $env:GOOGLE_CLOUD_PROJECT = "vehicle-drive-log"');
        console.error('     gcloud로 로그인하면 ADC의 기본 프로젝트가 다른 곳으로 잡혀 있을 수 있습니다.');
        console.error('  2. 그 프로젝트의 Firestore 읽기 권한이 계정에 있는지.\n');
        process.exit(1);
    }

    if (findings.length === 0) {
        console.log(`\n✅ 음수로 저장된 기록이 없습니다. (문서 ${totalScanned.toLocaleString()}건 확인)\n`);
        return;
    }

    const orgIds = [...new Set(findings.map((f) => f.organizationId))];
    const orgNames = await loadOrgNames(orgIds);

    console.log(`\n───────────────────────────────────────────────`);
    console.log(`문제 ${findings.length}건 · 기관 ${orgIds.length}곳`);
    console.log(`───────────────────────────────────────────────`);

    for (const orgId of orgIds) {
        const mine = findings.filter((f) => f.organizationId === orgId);
        console.log(`\n■ ${orgNames.get(orgId) ?? orgId} (${orgId}) — ${mine.length}건`);

        for (const spec of TARGETS) {
            const rows = mine.filter((f) => f.collection === spec.collection);
            if (rows.length === 0) continue;
            console.log(`  [${spec.label}] ${rows.length}건`);
            for (const r of rows) {
                const badge = r.kind === 'nan' ? '숫자 아님(NaN)' : r.value.toLocaleString();
                console.log(`    - ${r.fieldLabel}: ${badge}  |  ${r.context}  |  ${r.docId}`);
            }
        }
    }

    // 하이패스 과차감 — 잔액을 되돌려야 하는 유일한 항목이라 따로 뽑는다
    const overDeduction = summarizeHipassOverDeduction(findings);
    if (overDeduction.size > 0) {
        console.log(`\n───────────────────────────────────────────────`);
        console.log('⚠️  하이패스 카드 잔액 과차감 — 아래 금액만큼 실제보다 덜 남아 있습니다');
        console.log('───────────────────────────────────────────────');
        for (const [orgId, amount] of overDeduction) {
            console.log(`  ${orgNames.get(orgId) ?? orgId}: ${amount.toLocaleString()}원`);
        }
        console.log('\n  → [관리자] → [하이패스 관리]에서 카드의 현재 잔액을 실제 금액으로 정정하세요.');
        console.log('    (운행일지의 사용후 금액이 음수였던 만큼 잔액이 더 깎였습니다)');
    }

    if (csvPath) {
        // 앞에 BOM(U+FEFF)을 붙여야 엑셀이 UTF-8 한글을 깨지 않고 연다
        writeFileSync(csvPath, `\uFEFF${toCsv(findings, orgNames)}`, 'utf8');
        console.log(`\n📄 CSV 저장: ${csvPath} (엑셀에서 바로 열립니다)`);
    }

    console.log('\n(읽기 전용) 값을 어떻게 고칠지는 사람이 판단해야 해서 자동 수정하지 않습니다.');
    console.log('해당 화면에서 기록을 열어 올바른 값으로 저장하거나, 잘못된 기록이면 삭제하세요.\n');
}

/**
 * 인증 실패는 이 스크립트에서 가장 흔한 실패다(운영자 PC에는 보통 ADC가 없다).
 * Google SDK의 영문 스택을 그대로 뱉으면 무엇을 해야 할지 알 수 없어, 설정 방법을 안내한다.
 */
function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    return (
        msg.includes('Could not load the default credentials') ||
        msg.includes('Could not refresh access token') ||
        msg.includes('UNAUTHENTICATED') ||
        msg.includes('invalid_grant')
    );
}

function reportAndExit(err: unknown): never {
    if (isAuthError(err)) {
        console.error('\n❌ Google 인증 정보가 없어 Firestore에 접근하지 못했습니다.\n');
        console.error('아래 둘 중 하나를 설정한 뒤 다시 실행하세요.\n');
        console.error('  [1] gcloud CLI 사용 (권장 — 키 파일이 PC에 남지 않습니다)');
        console.error('      gcloud auth application-default login\n');
        console.error('  [2] 서비스 계정 키 파일 사용');
        console.error('      Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성');
        console.error('      PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\경로\\service-account.json"');
        console.error('      macOS/Linux: export GOOGLE_APPLICATION_CREDENTIALS="/경로/service-account.json"');
        console.error('      ⚠️ 키 파일은 저장소 폴더 밖에 두세요 (커밋되면 프로젝트 전체가 노출됩니다)\n');
        console.error(`대상 프로젝트: ${projectId ?? '(확인 실패 — GOOGLE_CLOUD_PROJECT를 지정하세요)'}\n`);
        process.exit(1);
    }
    console.error(err);
    process.exit(1);
}

// 인증 오류는 gRPC 내부에서 uncaught로 터져 main()의 catch를 우회하는 경로가 있다.
// 프로세스 레벨에서도 같은 안내를 내보내야 영문 스택만 남고 끝나지 않는다.
process.on('uncaughtException', reportAndExit);
process.on('unhandledRejection', reportAndExit);

main().catch(reportAndExit);
