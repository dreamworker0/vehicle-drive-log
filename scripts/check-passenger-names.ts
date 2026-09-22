/**
 * 진단(읽기 전용): 예약·바로탑승에 적어 둔 동승자 이름이 운행일지까지 갔는지 본다.
 *
 * 배경: "바로탑승으로 하면 이용자 이름이 운행 종료 후 사라진다"는 제보를 코드만으로는
 * 재현하지 못했다. 시작 화면 → 예약 문서 → 운행일지 자동 채움 → 저장 세 단계 모두
 * 이름을 싣고 있어, 실제 문서를 대조해 어디서 끊기는지 확인하는 것이 빠르다.
 *
 * 개인정보를 콘솔에 그대로 찍지 않는다 — 이름은 **첫 글자만** 남기고 마스킹한다.
 *
 * 사용법:
 *   npx tsx scripts/check-passenger-names.ts <기관명 일부> [최근N일=30]
 */
import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp } from './lib/adminApp';

const db = getFirestore(initAdminApp());

const mask = (n: string) => (n ? n[0] + '*'.repeat(Math.max(0, n.length - 1)) : '');
const masked = (names?: string[]) => `[${(names || []).map(mask).join(',')}]`;

async function main() {
    const orgQuery = process.argv[2] || '';
    const days = Number(process.argv[3] || 30);
    if (!orgQuery) {
        console.error('사용법: npx tsx scripts/check-passenger-names.ts <기관명 일부> [최근N일]');
        process.exit(1);
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().slice(0, 10);

    const orgs = await db.collection('organizations').get();
    const matched = orgs.docs.filter(d => (d.data().name || '').includes(orgQuery));
    if (!matched.length) {
        console.log(`'${orgQuery}'를 포함하는 기관이 없습니다.`);
        return;
    }

    for (const org of matched) {
        const orgId = org.id;
        console.log(`\n=== ${org.data().name} (${orgId}) — 최근 ${days}일 ===`);

        const resSnap = await db.collection('reservations')
            .where('organizationId', '==', orgId)
            .where('date', '>=', sinceStr)
            .get();
        const resById = new Map(resSnap.docs.map(d => [d.id, d.data()]));
        const resWithNames = resSnap.docs.filter(d => (d.data().passengerNames || []).length > 0);

        console.log(`예약 ${resSnap.size}건 (동승자 이름 있는 것 ${resWithNames.length}건)`);
        for (const d of resWithNames) {
            const r = d.data();
            console.log(`  예약 ${d.id.slice(0, 8)} ${r.date} ${r.isQuickDrive ? '바로탑승' : '예약'} ${r.status} 이름=${masked(r.passengerNames)} uid수=${(r.passengerUids || []).length} 외부수=${r.passengerCount ?? '-'}`);
        }

        const logSnap = await db.collection('driveLogs')
            .where('organizationId', '==', orgId)
            .where('timestamp', '>=', since)
            .get();

        console.log(`\n운행일지 ${logSnap.size}건:`);
        let lostCount = 0;
        let countMismatch = 0;
        for (const d of logSnap.docs) {
            const l = d.data();
            const r = l.reservationId ? resById.get(l.reservationId) : undefined;
            const resNames: string[] = r ? (r.passengerNames || []) : [];
            const logNames: string[] = l.passengerNames || [];
            const origin = l.reservationId ? (r ? (r.isQuickDrive ? '바로탑승' : '예약') : '예약(조회범위밖)') : '직접작성';

            // 예약엔 이름이 있는데 일지엔 없다 → 자동 채움·저장 경로에서 끊긴 건
            const lost = resNames.length > 0 && logNames.length === 0;
            // 이름 수 + 외부 인원 + 운전자 1과 저장된 탑승인원이 다르다 → 인원 계산이 어긋난 건
            const expected = logNames.length + (l.externalPassengerCount || 0) + 1;
            const mismatch = (l.passengerCount ?? 0) !== expected;
            if (lost) lostCount++;
            if (mismatch) countMismatch++;
            if (!lost && !mismatch && logNames.length === 0 && resNames.length === 0) continue;

            const date = l.timestamp?.toDate?.().toISOString().slice(0, 10) ?? '?';
            console.log(
                `  일지 ${d.id.slice(0, 10)} ${date} ${origin} 이름=${masked(logNames)} 인원=${l.passengerCount ?? '-'} 외부수=${l.externalPassengerCount ?? '-'} 입력원문="${(l.externalPassengerNames || '').split(',').map(s => mask(s.trim())).filter(Boolean).join(',')}" 예약이름=${resNames.length}건`
                + `${lost ? '  ← 예약엔 이름이 있는데 일지엔 없음' : ''}${mismatch ? `  ← 인원 불일치(기대 ${expected})` : ''}`,
            );
        }

        console.log(`\n요약: 이름 유실 ${lostCount}건 · 인원 불일치 ${countMismatch}건`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
