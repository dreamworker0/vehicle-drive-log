/**
 * 진단(읽기 전용): 예약·바로탑승에 적어 둔 동승자 이름이 운행일지까지 갔는지 본다.
 *
 * 배경: "바로탑승으로 하면 이용자 이름이 운행 종료 후 사라진다"는 제보를 코드만으로는
 * 재현하지 못했다. 시작 화면 → 예약 문서 → 운행일지 자동 채움 → 저장 세 단계 모두
 * 이름을 싣고 있어, 실제 문서를 대조해 어디서 끊기는지 확인하는 것이 빠르다.
 *
 * **이름을 출력하지 않는다.** 진단에 필요한 것은 "이름이 남았는가 · 몇 건인가"이고,
 * 첫 글자만 남기는 마스킹은 정보 가치가 없으면서 기관명·날짜와 합쳐지면 소규모 기관에서
 * 사람을 특정한다(한 글자 이름은 마스킹조차 되지 않는다).
 *
 * 사용법:
 *   npx tsx scripts/check-passenger-names.ts <기관명 일부> [최근N일=30]
 *
 * 기관명이 여러 곳에 걸리면 후보만 보여 주고 멈춘다 — 무관한 기관 데이터를 함께
 * 읽어 오지 않기 위해서다(읽기 비용도 기관 수만큼 곱해진다).
 */
import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp } from './lib/adminApp';

const db = getFirestore(initAdminApp());

/**
 * 직접 입력한 이름을 탑승인원에 세기 시작한 시점(#393 배포, 2026-09-22 09:16 KST).
 *
 * 그 전에 저장된 기록은 **옛 규칙**으로 계산돼 있다(직접 입력 이름은 인원에 세지 않았다).
 * 이 경계를 모르면 옛 기록 전부가 '인원 불일치'로 찍혀, 있지도 않은 버그를 쫓게 된다
 * (#393 공지에도 "이미 저장된 기록의 인원수는 저절로 고쳐지지 않는다"고 밝혔다).
 */
const NEW_COUNT_RULE_SINCE = new Date('2026-09-22T00:16:00Z');

/** 한국 시간 기준 YYYY-MM-DD (UTC로 찍으면 오전 9시 이전 운행이 하루 앞으로 밀린다) */
const kstDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

async function main() {
    const orgQuery = process.argv[2] || '';
    const daysArg = process.argv[3];
    const days = daysArg === undefined ? 30 : Number(daysArg);
    if (!orgQuery || !Number.isFinite(days) || days <= 0) {
        console.error('사용법: npx tsx scripts/check-passenger-names.ts <기관명 일부> [최근N일]');
        process.exit(1);
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // 예약은 날짜(문자열), 일지는 timestamp(Date)로 조회한다. 예약 쪽 창을 일주일 넓혀
    // 두어야 창 경계에 걸친 일지도 자기 예약과 짝지어진다(못 짝지으면 유실을 놓친다).
    const resSinceStr = kstDate(new Date(since.getTime() - 7 * 24 * 60 * 60 * 1000));

    const orgs = await db.collection('organizations').get();
    const matched = orgs.docs.filter(d => (d.data().name || '').includes(orgQuery));
    if (!matched.length) {
        console.log(`'${orgQuery}'를 포함하는 기관이 없습니다.`);
        return;
    }
    if (matched.length > 1) {
        console.log(`'${orgQuery}'에 여러 기관이 걸립니다 — 하나만 지정해 주세요:`);
        for (const d of matched) console.log(`  ${d.data().name} (${d.id})`);
        return;
    }

    const org = matched[0];
    const orgId = org.id;
    console.log(`\n=== ${org.data().name} (${orgId}) — 최근 ${days}일 ===`);

    const resSnap = await db.collection('reservations')
        .where('organizationId', '==', orgId)
        .where('date', '>=', resSinceStr)
        .get();
    const resById = new Map(resSnap.docs.map(d => [d.id, d.data()]));
    const resWithNames = resSnap.docs.filter(d => (d.data().passengerNames || []).length > 0);
    const quickCount = resSnap.docs.filter(d => d.data().isQuickDrive).length;

    console.log(`예약 ${resSnap.size}건 · 동승자 이름 있는 것 ${resWithNames.length}건 · 바로 운행 ${quickCount}건`);

    const logSnap = await db.collection('driveLogs')
        .where('organizationId', '==', orgId)
        .where('timestamp', '>=', since)
        .get();

    console.log(`\n운행일지 ${logSnap.size}건 — 살펴볼 것만 적는다:`);
    let lost = 0;
    let unjoined = 0;
    let mismatchNew = 0;
    let mismatchOld = 0;

    for (const d of logSnap.docs) {
        const l = d.data();
        const res = l.reservationId ? resById.get(l.reservationId) : undefined;
        const resNames: number = res ? (res.passengerNames || []).length : 0;
        const logNames: number = (l.passengerNames || []).length;
        const origin = l.reservationId
            ? (res ? (res.isQuickDrive ? '바로운행' : '예약') : '예약(조회범위밖)')
            : '직접작성';

        // 예약엔 이름이 있는데 일지엔 없다 → 자동 채움·저장·수정 경로에서 끊긴 건
        const namesLost = resNames > 0 && logNames === 0;
        // 짝을 못 지은 건은 유실 여부를 알 수 없다 — 요약이 낙관적으로 보이지 않게 따로 센다
        const cannotJudge = !!l.reservationId && !res;

        const createdAt: Date | undefined = l.createdAt?.toDate?.();
        const isNewRule = !!createdAt && createdAt >= NEW_COUNT_RULE_SINCE;
        const expected = logNames + (l.externalPassengerCount || 0) + 1;
        const mismatch = (l.passengerCount ?? 0) !== expected;

        if (namesLost) lost++;
        if (cannotJudge) unjoined++;
        if (mismatch) {
            if (isNewRule) mismatchNew++;
            else mismatchOld++;
        }

        // 새 규칙으로 저장된 뒤의 불일치만 이상으로 본다(옛 규칙 기록은 원래 이렇게 저장됐다)
        if (!namesLost && !cannotJudge && !(mismatch && isNewRule)) continue;

        const date = l.timestamp?.toDate?.() ? kstDate(l.timestamp.toDate()) : '?';
        console.log(
            `  일지 ${d.id.slice(0, 10)} ${date} ${origin}`
            + ` 일지이름 ${logNames}건 · 예약이름 ${resNames}건 · 인원 ${l.passengerCount ?? '-'} · 외부수 ${l.externalPassengerCount ?? '-'}`
            + `${namesLost ? '  ← 예약엔 이름이 있는데 일지엔 없음' : ''}`
            + `${mismatch && isNewRule ? `  ← 인원 불일치(기대 ${expected}, 새 규칙 이후 저장분)` : ''}`
            + `${cannotJudge ? '  ← 예약이 조회 범위 밖이라 대조 못 함' : ''}`,
        );
    }

    console.log(`\n요약: 이름 유실 ${lost}건 · 대조 불가 ${unjoined}건`);
    console.log(`      인원 불일치 — 새 규칙 이후 ${mismatchNew}건(이상) · 그 이전 ${mismatchOld}건(옛 규칙대로 저장된 것)`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
