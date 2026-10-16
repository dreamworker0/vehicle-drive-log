import { describe, it, expect } from 'vitest';
import { buildExternalLoanDriveLog, resolveLoanPeriod } from '@/hooks/utils/externalLoanReturn';
import type { Reservation } from '@/types/reservation';

/**
 * 외부 대여 반납 → 운행일지 한 건. 대여 기간 전체를 한 건으로 남겨 계기판 km를 잇고,
 * 운전자는 기관 구성원이 아니라 uid를 비운다.
 */
const loan = { borrowerOrg: '동산 사회복지관', driverName: '홍길동' };

function day(id: string, date: string, startTime: string, endTime: string, over: Partial<Reservation> = {}): Reservation {
    return {
        id, organizationId: 'org1', vehicleId: 'v1', vehicleName: '스타렉스', reservedByUid: '',
        reservedByName: '(외부) 동산 사회복지관 홍길동', date, startTime, endTime, status: 'reserved',
        groupId: 'grp1', externalLoan: loan, ...over,
    } as Reservation;
}

const group = [
    day('d2', '2026-10-21', '00:00', '23:59'),
    day('d1', '2026-10-20', '14:00', '23:59'),
    day('d3', '2026-10-22', '00:00', '11:00'),
    day('x', '2026-10-23', '00:00', '09:00', { status: 'cancelled' }),
];
const NOW = new Date(2026, 9, 22, 12, 0); // 10/22 12:00

describe('resolveLoanPeriod', () => {
    it('같은 묶음을 날짜순으로 모아 기간을 구한다 (취소된 날 제외)', () => {
        const p = resolveLoanPeriod(group[0], group);
        expect(p.first.id).toBe('d1');
        expect(p.days.map(d => d.id)).toEqual(['d1', 'd2', 'd3']);
        expect([p.startDate, p.startTime, p.plannedEndDate, p.plannedEndTime]).toEqual(['2026-10-20', '14:00', '2026-10-22', '11:00']);
    });

    it('하루짜리 대여는 그 예약 하나다', () => {
        const single = day('s1', '2026-10-20', '09:00', '18:00', { groupId: undefined });
        expect(resolveLoanPeriod(single, [single]).days).toEqual([single]);
    });
});

describe('buildExternalLoanDriveLog', () => {
    const base = () => ({
        orgId: 'org1', adminUid: 'adm1', reservation: group[0],
        period: resolveLoanPeriod(group[0], group),
        startKm: '50000', endKm: '50320', returnDate: '2026-10-22', returnTime: '10:30', now: NOW,
    });

    it('대여 전체를 한 건으로 — 출발일·외부 운전자·대여 표시·첫날 예약 연결', () => {
        const r = buildExternalLoanDriveLog(base());
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.data).toMatchObject({
            organizationId: 'org1', vehicleId: 'v1',
            driverUid: '', driverName: '(외부) 동산 사회복지관 홍길동', createdByUid: 'adm1',
            startKm: 50000, endKm: 50320, distance: 320,
            startTime: '14:00', endTime: '10:30', startDate: '2026-10-20',
            driveOrigin: 'external_loan', reservationId: 'd1',
            externalLoan: { borrowerOrg: '동산 사회복지관', driverName: '홍길동', groupId: 'grp1' },
        });
        expect(r.data.purpose).toBe('외부 대여(동산 사회복지관)');
        // timestamp는 도착(반납) 시각이다
        expect((r.data.timestamp as Date).getTime()).toBe(new Date(2026, 9, 22, 10, 30).getTime());
        expect(r.data).not.toHaveProperty('isRetroactive');
        expect(r.id).toBe('v1_adm1_20261020_50000_50320');
    });

    it('같은 날 반납이면 출발일을 따로 남기지 않는다', () => {
        const single = day('s1', '2026-10-22', '08:00', '11:00', { groupId: undefined });
        const r = buildExternalLoanDriveLog({ ...base(), reservation: single, period: resolveLoanPeriod(single, [single]) });
        expect(r.ok && r.data).not.toHaveProperty('startDate');
    });

    it('지난 날짜로 반납을 기록하면 소급 표시를 단다', () => {
        const r = buildExternalLoanDriveLog({ ...base(), returnDate: '2026-10-21', returnTime: '20:00' });
        expect(r.ok && r.data.isRetroactive).toBe(true);
    });

    it.each([
        ['도착 km가 비면', { endKm: '' }, '0 이상의 정수'],
        ['소수면', { endKm: '50320.5' }, '0 이상의 정수'],
        ['도착 km가 출발보다 작으면', { endKm: '49999' }, '작을 수 없습니다'],
        ['주행거리가 상한을 넘으면', { endKm: '60001' }, '넘습니다'],
        ['반납이 대여 시작보다 이르면', { returnDate: '2026-10-20', returnTime: '13:00' }, '늦어야'],
        ['반납이 아직 오지 않은 시각이면', { returnTime: '12:30' }, '아직 오지 않은'],
    ])('%s 거부한다', (_label, patch, message) => {
        const r = buildExternalLoanDriveLog({ ...base(), ...patch });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain(message);
    });

    it('대여가 아닌 예약은 거부한다', () => {
        const normal = day('n1', '2026-10-20', '09:00', '10:00', { externalLoan: undefined, groupId: undefined });
        const r = buildExternalLoanDriveLog({ ...base(), reservation: normal, period: resolveLoanPeriod(normal, [normal]) });
        expect(r.ok).toBe(false);
    });
});
