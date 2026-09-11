/**
 * check-truncated-numbers — 잘려 저장된 숫자 점검 (읽기 전용 운영 스크립트)
 *
 * 저장 시 `parseInt`를 쓰던 시절(#370 이전), `<input type="number">`가 넘기는 지수 표기가
 * 잘려 저장될 수 있었다 — `parseInt('1e5')`는 **1**이다. 화면에는 100,000으로 보이고
 * 검증(`Number` 기준)도 통과하는데 저장만 1이 됐다. 코드는 고쳤지만 **이미 저장된 값은
 * 저절로 돌아오지 않아서**, 실제로 그런 기록이 남아 있는지 세어 보는 스크립트다.
 *
 * **고치지는 않는다.** 값이 얼마였어야 하는지는 영수증을 본 사람만 안다. 자동 보정은
 * `1`을 `100,000`으로 지어내는 일이 되므로 하지 않는다(check-negative-values와 같은 자세).
 *
 * 판정 규칙은 `scripts/lib/truncatedNumberRules.ts`에 있다 — 단위 테스트가 같은 규칙을 본다.
 * 음수·NaN은 이 스크립트가 보지 않는다. `check-negative-values.ts`의 몫이다.
 *
 * 사용법 (프로젝트 루트에서, Node 22):
 *   npx tsx scripts/check-truncated-numbers.ts
 *   npx tsx scripts/check-truncated-numbers.ts --org=<organizationId>
 *   npx tsx scripts/check-truncated-numbers.ts --csv=truncated.csv
 *
 * 실행 전 Google 인증(ADC)이 필요하다. 둘 중 하나:
 *   gcloud auth application-default login          ← 키 파일이 남지 않아 이쪽을 권장
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<서비스계정.json 경로>"   (PowerShell)
 * 인증이 없으면 실행 시 설정 방법을 안내하고 중단한다.
 */
import { writeFileSync } from 'node:fs';
import { getFirestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { initAdminApp, resolveProjectId } from './lib/adminApp';
import {
    AUDITED_COLLECTIONS,
    CONFIDENCE_LABEL,
    CONFIDENCE_ORDER,
    findTruncationCandidates,
    floorRulesFor,
    type Candidate,
    type Confidence,
} from './lib/truncatedNumberRules';

// 대상 프로젝트 고정의 근거는 lib/adminApp.ts에 있다.
const projectId = resolveProjectId();
initAdminApp({ quiet: true });
const db = getFirestore();

const args = process.argv.slice(2);
const orgFilter = args.find((a) => a.startsWith('--org='))?.split('=')[1];
const csvPath = args.find((a) => a.startsWith('--csv='))?.split('=')[1];

/** 한 번에 읽어올 문서 수 — 기관 전체를 훑으므로 페이지 단위로 끊는다 */
const PAGE_SIZE = 500;

/** 컬렉션별 표시 이름과 한 줄 맥락 — 리포트에서 "어느 기록인지" 알아볼 수 있어야 한다 */
const COLLECTION_META: Record<string, { label: string; context: (d: Record<string, unknown>) => string }> = {
    fuelLogs: {
        label: '주유·충전 기록',
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.driverName ?? '?'}`,
    },
    hipassCharges: {
        label: '하이패스 충전 기록',
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.chargerName ?? '?'}`,
    },
    maintenanceRecords: {
        label: '정비 기록',
        context: (d) => `${d.date ?? '?'} · ${d.vehicleName ?? '?'} · ${d.type ?? '?'}`,
    },
    hipassCards: {
        label: '하이패스 카드',
        context: (d) => `${d.cardNumber ?? '?'} · ${d.vehicleName ?? '?'}`,
    },
    vehicles: {
        label: '차량',
        context: (d) => `${d.displayName ?? d.name ?? '?'} · ${d.plateNumber ?? '?'}`,
    },
};

interface Finding extends Candidate {
    organizationId: string;
    collection: string;
    collectionLabel: string;
    docId: string;
    context: string;
}

/** 전체 컬렉션에서 읽은 문서 수 — 0이면 엉뚱한 곳을 본 것이라 "이상 없음"으로 단정하면 안 된다 */
let totalScanned = 0;

/** 컬렉션 하나를 페이지 단위로 훑어 후보를 모은다 */
async function scan(collection: string): Promise<Finding[]> {
    const meta = COLLECTION_META[collection];
    const findings: Finding[] = [];
    let last: QueryDocumentSnapshot | null = null;
    let scanned = 0;

    for (;;) {
        let q: Query = db.collection(collection);
        if (orgFilter) q = q.where('organizationId', '==', orgFilter);
        q = q.orderBy('__name__').limit(PAGE_SIZE);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            const data = doc.data();
            for (const candidate of findTruncationCandidates(collection, data)) {
                findings.push({
                    ...candidate,
                    organizationId: (data.organizationId as string) || '(기관 없음)',
                    collection,
                    collectionLabel: meta.label,
                    docId: doc.id,
                    context: meta.context(data),
                });
            }
        }

        scanned += snap.docs.length;
        totalScanned += snap.docs.length;
        last = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) break;
    }

    console.log(`  ${meta.label.padEnd(16)} 문서 ${String(scanned).padStart(6)}건 → 후보 ${findings.length}건`);
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

function toCsv(findings: Finding[], orgNames: Map<string, string>): string {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ['기관ID', '기관명', '컬렉션', '항목', '문서ID', '필드', '값', '단위', '확신도', '근거', '맥락'].join(',');
    const rows = findings.map((f) =>
        [
            esc(f.organizationId),
            esc(orgNames.get(f.organizationId) ?? ''),
            esc(f.collection),
            esc(f.collectionLabel),
            esc(f.docId),
            esc(f.label),
            f.value,
            esc(f.unit),
            esc(CONFIDENCE_LABEL[f.confidence]),
            esc(f.reason),
            esc(f.context),
        ].join(',')
    );
    return [header, ...rows].join('\n');
}

/** 리포트 머리말에 판정 기준을 그대로 보여 준다 — 기준을 모르면 결과를 믿을 수 없다 */
function printCriteria(): void {
    console.log('판정 기준 (이 값보다 작은 **양수**만 후보로 본다):');
    for (const collection of AUDITED_COLLECTIONS) {
        const rules = floorRulesFor(collection);
        const summary = rules.map((r) => `${r.label} < ${r.floor.toLocaleString()}${r.unit}`).join(' · ');
        console.log(`  ${COLLECTION_META[collection].label.padEnd(16)} ${summary}`);
    }
    console.log('  0은 미입력으로 보고 건너뛴다. 음수·NaN은 check-negative-values.ts가 본다.\n');
}

async function main() {
    console.log('\n=== 잘려 저장된 숫자 점검 (읽기 전용) ===');
    console.log('지수 표기가 parseInt로 잘려 저장됐을 수 있는 기록을 찾습니다 (#370 이전 저장분).\n');
    if (orgFilter) console.log(`기관 한정: ${orgFilter}\n`);
    printCriteria();

    const findings: Finding[] = [];
    for (const collection of AUDITED_COLLECTIONS) {
        findings.push(...(await scan(collection)));
    }

    // 문서를 한 건도 못 읽었다면 데이터가 깨끗한 게 아니라 **엉뚱한 곳을 본 것**이다.
    // (check-negative-values가 실제로 겪은 함정이다 — ADC 기본 프로젝트가 달라 0건이 나왔다.)
    if (totalScanned === 0) {
        console.error('\n⚠️  문서를 한 건도 읽지 못했습니다 — 점검이 이루어지지 않았습니다.\n');
        console.error(`조회한 프로젝트: ${projectId ?? '(미지정)'}`);
        if (orgFilter) console.error(`기관 한정: ${orgFilter}  ← 이 기관 ID가 맞는지 확인하세요`);
        console.error('\n확인할 것:');
        console.error('  1. 프로젝트가 맞는지 — 운영 데이터는 vehicle-drive-log에 있습니다.');
        console.error('     PowerShell:  $env:GOOGLE_CLOUD_PROJECT = "vehicle-drive-log"');
        console.error('  2. 그 프로젝트의 Firestore 읽기 권한이 계정에 있는지.\n');
        process.exit(1);
    }

    if (findings.length === 0) {
        console.log(`\n✅ 잘린 것으로 보이는 값이 없습니다. (문서 ${totalScanned.toLocaleString()}건 확인)`);
        console.log('   지수 표기를 손으로 입력하는 일이 드물어 예상되는 결과입니다 — 그래도 세어 본 값입니다.\n');
        return;
    }

    const orgIds = [...new Set(findings.map((f) => f.organizationId))];
    const orgNames = await loadOrgNames(orgIds);

    findings.sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]);

    console.log('\n───────────────────────────────────────────────');
    console.log(`후보 ${findings.length}건 · 기관 ${orgIds.length}곳 (문서 ${totalScanned.toLocaleString()}건 확인)`);
    const byConfidence = (c: Confidence) => findings.filter((f) => f.confidence === c).length;
    console.log(`확신도 — 높음 ${byConfidence('high')} · 보통 ${byConfidence('medium')} · 낮음 ${byConfidence('low')}`);
    console.log('───────────────────────────────────────────────');

    for (const orgId of orgIds) {
        const mine = findings.filter((f) => f.organizationId === orgId);
        console.log(`\n■ ${orgNames.get(orgId) ?? orgId} (${orgId}) — ${mine.length}건`);
        for (const f of mine) {
            console.log(`  [${CONFIDENCE_LABEL[f.confidence]}] ${f.collectionLabel} · ${f.label}: ${f.value.toLocaleString()}${f.unit}`);
            console.log(`        ${f.reason}`);
            console.log(`        ${f.context}  |  ${f.docId}`);
        }
    }

    if (csvPath) {
        // 앞에 BOM(U+FEFF)을 붙여야 엑셀이 UTF-8 한글을 깨지 않고 연다
        writeFileSync(csvPath, `\uFEFF${toCsv(findings, orgNames)}`, 'utf8');
        console.log(`\n📄 CSV 저장: ${csvPath} (엑셀에서 바로 열립니다)`);
    }

    console.log('\n(읽기 전용) 원래 값이 얼마였는지는 영수증을 본 사람만 알기에 자동으로 고치지 않습니다.');
    console.log('확신도 "높음"부터 해당 화면에서 기록을 열어 올바른 값으로 저장하세요.');
    console.log('  · 주유·하이패스: [관리자] → [일지 관리] → 각 탭의 ✏️ 수정');
    console.log('  · 정비: [관리자] → [정비 기록] · 카드 잔액: [관리자] → [하이패스 관리]');
    console.log('  · 차량 누적 km: [관리자] → [차량 관리]\n');
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
        console.error('      ⚠️ 키 파일은 저장소 폴더 밖에 두세요 (커밋되면 프로젝트 전체가 노출됩니다)\n');
        console.error(`대상 프로젝트: ${projectId ?? '(확인 실패 — GOOGLE_CLOUD_PROJECT를 지정하세요)'}\n`);
        process.exit(1);
    }
    console.error(err);
    process.exit(1);
}

// 인증 오류는 gRPC 내부에서 uncaught로 터져 main()의 catch를 우회하는 경로가 있다.
process.on('uncaughtException', reportAndExit);
process.on('unhandledRejection', reportAndExit);

main().catch(reportAndExit);
