/**
 * check-multiday-stuck-reservations — 조기 반납으로 잘못 닫힌 다일 예약 점검 (읽기 전용)
 *
 * ## 무엇을 찾는가
 *
 * 2026-09-05 배포(#323)와 그날의 수정(#325) 사이 약 50분 동안, 다일 예약의 운행일지를
 * 저장하면 **아직 오지 않은 날짜까지** `completed`로 닫혔다. 그런데 그 문서에는
 * `actualStartTime`이 없다. 그래서 세 가지가 한꺼번에 어긋난다.
 *
 *   (1) 대시보드가 `completed`를 걸러 **화면에서 사라진다** — 사용자는 끝났다고 본다
 *   (2) 그러나 겹침 검사는 `completed && actualStartTime`일 때만 실제 시각으로 접으므로,
 *       `00:00~23:59` 전체를 **계속 점유한다**
 *   (3) 취소도 안 된다 — 그룹 취소가 `completed`를 대상에서 빼기 때문에 쓰기가 0건이다
 *
 * 결과적으로 **보이지도 풀리지도 않는 예약**이 남아, 그 차량은 아무도 예약하지 못하고
 * 예약자 본인은 그 기간에 어떤 차량도 잡지 못한다(사람 겹침 검사도 같은 규칙).
 *
 * #325 이후로는 타지 않은 날이 `cancelled`로 정리되므로 **새로 생기지 않는다.** 이 스크립트는
 * 그 사이에 이미 만들어진 문서만 찾는다.
 *
 * ## 어떻게 판정하는가
 *
 * 그룹의 **실제 도착일**을 구해, 그보다 뒤인데 `completed`인 형제를 잘못 닫힌 것으로 본다.
 * 도착일은 두 경로로 구하고, 둘 다 실패하면 **추측하지 않고 '판정 불가'로 남긴다** —
 * 정상 종료된 다일 예약을 잘못 지목하면 멀쩡한 기록을 되살리는 일이 벌어진다.
 *
 *   ① 그룹의 예약을 가리키는 운행일지의 `timestamp`(= 도착 시각)의 KST 날짜  ← 가장 확실
 *   ② 실패 시, `actualEndTime`이 찍힌 형제(운행일지가 붙은 그 날)의 `date`
 *
 * ## 고치지는 않는다
 *
 * 대상이 나오면 해당 문서의 `status`를 `cancelled`로 바꾸면 차량이 곧바로 풀린다. 다만
 * "그 예약을 정말 취소해도 되는가"는 이용자에게 확인할 일이라 자동으로 쓰지 않는다.
 *
 * 사용법 (프로젝트 루트에서, Node 22):
 *   npx tsx scripts/check-multiday-stuck-reservations.ts
 *   npx tsx scripts/check-multiday-stuck-reservations.ts --org=<organizationId>
 *   npx tsx scripts/check-multiday-stuck-reservations.ts --from=2026-09-01
 *
 * 실행 전 Google 인증(ADC)이 필요하다. 둘 중 하나:
 *   gcloud auth application-default login          ← 키 파일이 남지 않아 이쪽을 권장
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "<서비스계정.json 경로>"   (PowerShell)
 * 인증이 없으면 실행 시 설정 방법을 안내하고 중단한다.
 */
import { getFirestore, type QueryDocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { initAdminApp, resolveProjectId } from './lib/adminApp';

// 대상 프로젝트 고정의 근거는 lib/adminApp.ts에 있다 (엉뚱한 프로젝트를 조회해 조용히 0건이 나오는 사고).
const projectId = resolveProjectId();
initAdminApp({ quiet: true });
const db = getFirestore();

const args = process.argv.slice(2);
const orgFilter = args.find((a) => a.startsWith('--org='))?.split('=')[1];
/** 스캔 시작일 — 결함이 있던 배포일이 기본값이다. 그 이전 날짜의 예약은 이 결함과 무관하다. */
const fromDate = args.find((a) => a.startsWith('--from='))?.split('=')[1] ?? '2026-09-05';

/** Firestore `in` 절의 값 상한 */
const IN_CHUNK = 30;

/** KST 기준 YYYY-MM-DD. 예약 `date`가 그 형식이라 같은 축으로 맞춘다. */
const kstDateString = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

interface Res {
    id: string;
    organizationId?: string;
    groupId?: string;
    status?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    vehicleName?: string;
    reservedByName?: string;
    reservedByUid?: string;
    actualStartTime?: string;
    actualEndTime?: string;
}

const toRes = (doc: QueryDocumentSnapshot): Res => ({ id: doc.id, ...(doc.data() as Omit<Res, 'id'>) });

interface Finding {
    res: Res;
    /** 판정 기준이 된 도착일 */
    arrivalDate: string;
    /** 도착일을 무엇으로 구했는가 (리포트에 그대로 적어 사람이 재확인할 수 있게 한다) */
    basis: string;
    /** 오늘 이후라 지금도 차량을 막고 있는가 */
    blocking: boolean;
}

async function main() {
    console.log(`대상 프로젝트: ${projectId ?? '(미지정 — ADC 기본값. 결과를 믿지 말 것)'}`);
    console.log(`스캔 범위: date >= ${fromDate}${orgFilter ? ` · 기관 ${orgFilter}` : ' · 전체 기관'}\n`);

    // 1) 후보 수집 — `date` 단일 필드 범위라 복합 인덱스가 필요 없다.
    //    status·groupId는 메모리에서 거른다(일회성 점검이라 읽기보다 인덱스 추가가 더 비싸다).
    let query = db.collection('reservations').where('date', '>=', fromDate);
    if (orgFilter) query = query.where('organizationId', '==', orgFilter);
    const snap = await query.get();

    const all = snap.docs.map(toRes);
    const inGroup = all.filter((r) => r.groupId);
    const closedWithGroup = inGroup.filter((r) => r.status === 'completed' && !r.actualStartTime);

    // 다일 예약 건수를 함께 찍는다 — 이게 없으면 "0건"이 **정말 없는 것**인지
    // 스캔이 다일 예약을 아예 못 본 것인지 구분되지 않는다. 조용히 0을 내는 조회는
    // 없는 도구보다 나쁘다(lib/adminApp.ts의 프로젝트 고정과 같은 이유).
    console.log(`읽은 예약 ${snap.size}건 · 그중 다일 그룹 ${inGroup.length}건 · 잘못 닫혔을 후보 ${closedWithGroup.length}건`);
    if (inGroup.length === 0) {
        console.log('  (이 범위에 다일 예약 자체가 없습니다 — --from을 앞당겨 다시 확인해 보세요)');
    }

    if (closedWithGroup.length === 0) {
        console.log('\n✅ 대상 없음 — 잘못 닫힌 다일 예약이 없습니다.\n');
        return;
    }

    // 2) 그룹 전체를 다시 읽는다. 도착일 판정에는 **스캔 범위 밖의 앞선 날짜**가 필요하다
    //    (첫날이 fromDate보다 이르면 위 쿼리에 잡히지 않는다).
    const groupIds = [...new Set(closedWithGroup.map((r) => r.groupId as string))];
    const siblingsByGroup = new Map<string, Res[]>();
    for (let i = 0; i < groupIds.length; i += IN_CHUNK) {
        const chunk = groupIds.slice(i, i + IN_CHUNK);
        const gsnap = await db.collection('reservations').where('groupId', 'in', chunk).get();
        for (const doc of gsnap.docs) {
            const r = toRes(doc);
            const gid = r.groupId as string;
            if (!siblingsByGroup.has(gid)) siblingsByGroup.set(gid, []);
            siblingsByGroup.get(gid)!.push(r);
        }
    }

    // 3) 그룹별 운행일지를 찾아 도착 시각을 얻는다 — 가장 확실한 근거다.
    const allResIds = [...siblingsByGroup.values()].flat().map((r) => r.id);
    const arrivalByResId = new Map<string, Date>();
    for (let i = 0; i < allResIds.length; i += IN_CHUNK) {
        const chunk = allResIds.slice(i, i + IN_CHUNK);
        const lsnap = await db.collection('driveLogs').where('reservationId', 'in', chunk).get();
        for (const doc of lsnap.docs) {
            const data = doc.data() as { reservationId?: string; timestamp?: Timestamp };
            const ts = data.timestamp?.toDate?.();
            if (data.reservationId && ts) arrivalByResId.set(data.reservationId, ts);
        }
    }

    // 4) 판정
    const findings: Finding[] = [];
    const undecided: { groupId: string; rows: Res[] }[] = [];
    const today = kstDateString(new Date());

    for (const [gid, siblings] of siblingsByGroup) {
        // ① 운행일지의 도착 시각
        const logged = siblings.find((r) => arrivalByResId.has(r.id));
        // ② 운행일지를 못 찾으면 actualEndTime이 찍힌 형제의 날짜
        const drivenSibling = siblings.find((r) => r.actualEndTime);

        let arrivalDate: string | undefined;
        let basis = '';
        if (logged) {
            arrivalDate = kstDateString(arrivalByResId.get(logged.id)!);
            basis = `운행일지 도착 시각 (예약 ${logged.id})`;
        } else if (drivenSibling?.date) {
            arrivalDate = drivenSibling.date;
            basis = `actualEndTime이 찍힌 형제 (예약 ${drivenSibling.id})`;
        }

        const closed = siblings.filter((r) => r.status === 'completed' && !r.actualStartTime);
        if (!arrivalDate) {
            // 근거가 없으면 지목하지 않는다. 정상 종료를 잘못 되살리는 쪽이 더 나쁘다.
            undecided.push({ groupId: gid, rows: closed });
            continue;
        }

        for (const r of closed) {
            if (!r.date || r.date <= arrivalDate) continue; // 실제로 탄 날 — 완료가 맞다
            findings.push({ res: r, arrivalDate, basis, blocking: r.date >= today });
        }
    }

    // 5) 리포트
    if (findings.length === 0 && undecided.length === 0) {
        console.log('\n✅ 대상 없음 — 완료로 닫힌 문서가 모두 실제로 운행한 날입니다.\n');
        return;
    }

    if (findings.length > 0) {
        const blocking = findings.filter((f) => f.blocking);
        console.log(`\n🚨 잘못 닫힌 예약 ${findings.length}건 (그중 지금도 차량을 막는 것 ${blocking.length}건)\n`);

        const byOrg = new Map<string, Finding[]>();
        for (const f of findings) {
            const org = f.res.organizationId ?? '(기관 없음)';
            if (!byOrg.has(org)) byOrg.set(org, []);
            byOrg.get(org)!.push(f);
        }

        for (const [org, rows] of byOrg) {
            console.log(`── 기관 ${org}`);
            for (const f of rows.sort((a, b) => (a.res.date ?? '').localeCompare(b.res.date ?? ''))) {
                const r = f.res;
                const mark = f.blocking ? '🚨 차량 점유 중' : '· 지난 날짜(무해)';
                console.log(`  ${mark}  ${r.date} ${r.startTime}~${r.endTime}  ${r.vehicleName ?? '차량?'}  ${r.reservedByName ?? r.reservedByUid ?? '예약자?'}`);
                console.log(`      reservations/${r.id}   (그룹 ${r.groupId})`);
                console.log(`      실제 도착일 ${f.arrivalDate} — 근거: ${f.basis}`);
            }
            console.log('');
        }

        console.log('처방: 위 문서의 status를 completed → cancelled 로 바꾸면 차량이 곧바로 풀립니다.');
        console.log('      (겹침 검사가 cancelled를 제외합니다. driveLogReminderSent는 그대로 둬도 무해합니다.)');
        console.log('      취소해도 되는지는 예약자에게 확인한 뒤 바꾸세요 — 그래서 자동으로 쓰지 않습니다.\n');
    }

    if (undecided.length > 0) {
        console.log(`⚠️  도착일을 판정하지 못한 그룹 ${undecided.length}개 — 운행일지도, actualEndTime도 없습니다.`);
        console.log('    (운행 종료를 누르지 않았거나 일지 저장이 실패한 경우일 수 있습니다. 사람이 확인하세요.)');
        for (const u of undecided) {
            console.log(`  그룹 ${u.groupId}: ${u.rows.map((r) => `${r.date}(reservations/${r.id})`).join(', ')}`);
        }
        console.log('');
    }
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
