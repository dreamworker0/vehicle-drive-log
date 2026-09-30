/**
 * monthlyReportCalc — 월간보고서 통계 계산 테스트
 *
 * 관리자가 결재에 올리는 숫자다. 합계가 틀려도 화면은 멀쩡해 보이므로 여기서 고정한다.
 * 특히 "전월 대비" 계산은 기간 길이에 따라 비교 구간 자체가 달라져 눈으로 검산하기 어렵다.
 */
import { describe, it, expect } from 'vitest';
import {
    calcDriveStats,
    filterPrevPeriodLogs,
    calcComparePeriod,
    calcFuelStats,
    calcHipassStats,
    calcCostTrend,
    formatDriverData,
    formatVehicleData,
    formatPurposeData,
    formatDailyTrendData,
} from '../../hooks/utils/monthlyReportCalc';
import type { DriveLog } from '../../types/driveLog';
import type { FuelLog } from '../../types/fuelLog';
import type { HipassCharge } from '../../types/hipassCharge';

function log(over: Partial<DriveLog> = {}): DriveLog {
    return {
        id: 'l1',
        organizationId: 'org1',
        vehicleId: 'v1',
        driverUid: 'u1',
        timestamp: new Date('2026-03-05T09:00:00+09:00'),
        startKm: 1000,
        endKm: 1050,
        date: '2026-03-05',
        ...over,
    } as DriveLog;
}

function fuel(over: Partial<FuelLog> = {}): FuelLog {
    return {
        id: 'f1',
        organizationId: 'org1',
        vehicleId: 'v1',
        driverUid: 'u1',
        date: '2026-03-05',
        meterReading: 1000,
        fuelAmount: 30,
        fuelCost: 45000,
        ...over,
    } as FuelLog;
}

function hipass(over: Partial<HipassCharge> = {}): HipassCharge {
    return {
        id: 'h1',
        organizationId: 'org1',
        cardId: 'c1',
        cardNumber: '1234',
        vehicleId: 'v1',
        chargerUid: 'u1',
        date: '2026-03-05',
        chargeAmount: 10000,
        balanceBefore: 0,
        balanceAfter: 10000,
        ...over,
    } as HipassCharge;
}

describe('calcDriveStats', () => {
    it('건수·거리·미완료를 합산한다', () => {
        const s = calcDriveStats(
            [
                log({ id: 'a', startKm: 100, endKm: 150 }),
                log({ id: 'b', startKm: 150, endKm: 200, isIncomplete: true }),
                log({ id: 'c', startKm: 200, endKm: 210 }),
            ],
            [],
            '2026-03-01',
            '2026-03-31',
        );

        expect(s.totalRuns).toBe(3);
        expect(s.totalDistance).toBe(110);
        expect(s.incompleteCount).toBe(1);
        expect(s.avgDistance).toBe(37); // 110/3 반올림
    });

    it('거리는 저장된 distance를 먼저 쓰고, 음수는 0으로 센다 — 분석 화면(야간 집계)과 같은 규칙', () => {
        const s = calcDriveStats(
            [
                log({ id: 'a', startKm: 100, endKm: 150, distance: 60 }), // 정정·다일 기록은 distance가 정본
                log({ id: 'b', startKm: 500, endKm: 400 }),               // 계기판 역전 — 합계를 깎지 않는다
            ],
            [], '2026-03-01', '2026-03-31',
        );
        expect(s.totalDistance).toBe(60);
    });

    it('기록이 없으면 평균이 0으로 떨어지고 0으로 나누지 않는다', () => {
        const s = calcDriveStats([], [], '2026-03-01', '2026-03-31');
        expect(s.totalRuns).toBe(0);
        expect(s.avgDistance).toBe(0);
        expect(s.avgDailyRuns).toBe('0');
    });

    it('일평균 운행은 기간 일수로 나눈다(양 끝 포함)', () => {
        const s = calcDriveStats([log(), log({ id: 'b' })], [], '2026-03-01', '2026-03-10');
        expect(s.avgDailyRuns).toBe('0.2'); // 2건 / 10일
    });

    it('비교 구간 대비 증감률을 낸다 — 비교 구간이 비어 있으면 null(비교 없음)', () => {
        const cur = [log({ startKm: 0, endKm: 200 })];
        // 예전에는 +100%로 보여 급증처럼 읽혔다
        expect(calcDriveStats(cur, [], '2026-03-01', '2026-03-31').distanceChange).toBeNull();
        expect(calcDriveStats([], [], '2026-03-01', '2026-03-31').runsChange).toBeNull();

        const prev = [log({ id: 'p', startKm: 0, endKm: 100 })];
        expect(calcDriveStats(cur, prev, '2026-03-01', '2026-03-31').distanceChange).toBe(100); // 100 → 200
        expect(calcDriveStats(prev, cur, '2026-03-01', '2026-03-31').distanceChange).toBe(-50);
    });

    it('직원·차량·목적별로 나눠 담고, 이름이 없으면 미지정으로 묶는다', () => {
        const s = calcDriveStats(
            [
                log({ id: 'a', driverName: '홍길동', vehicleName: '스타렉스', purpose: '출장' }),
                log({ id: 'b', driverName: '홍길동', vehicleDisplayName: '카니발', purpose: '출장' }),
                log({ id: 'c' }),
            ],
            [], '2026-03-01', '2026-03-31',
        );

        expect(s.byDriver['홍길동'].count).toBe(2);
        expect(s.byDriver['(이름 없음)'].count).toBe(1);
        // 차량은 vehicleId로 묶는다(주유 기록과 짝짓기 위해). 이름은 처음 만난 기록의 표시명
        expect(Object.keys(s.byVehicle)).toEqual(['v1']);
        expect(s.byVehicle.v1.count).toBe(3);
        const noId = calcDriveStats([log({ vehicleId: '', vehicleDisplayName: '카니발' })], [], '2026-03-01', '2026-03-31');
        expect(noId.byVehicle['카니발']).toMatchObject({ name: '카니발', count: 1 }); // ID가 없으면 이름으로
        expect(s.byPurpose['출장']).toBe(2);
        expect(s.byPurpose['(미지정)']).toBe(1);
    });

    it('요일별·시간대별로 나눈다 — 2026-03-05는 목요일', () => {
        const s = calcDriveStats(
            [log({ startTime: '09:30' }), log({ id: 'b', startTime: '09:00' }), log({ id: 'c', startTime: '' })],
            [], '2026-03-01', '2026-03-31',
        );
        expect(s.byDayOfWeek[4].count).toBe(3);
        expect(s.byHour[9]).toBe(2); // 시작 시각이 빈 기록은 세지 않는다
    });

    it('시간대가 24시를 넘는 깨진 값은 버린다', () => {
        const s = calcDriveStats([log({ startTime: '99:00' })], [], '2026-03-01', '2026-03-31');
        expect(s.byHour.reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('일별 추이는 date가 없어도 도착 시각(timestamp)의 날짜로 묶는다 — 운행일지에는 date 필드가 없다', () => {
        // 예전에는 l.date로만 묶어 새 일지가 전부 빠졌고, 차트가 늘 숨겨졌다
        const s = calcDriveStats([log({ date: undefined })], [], '2026-03-01', '2026-03-31');
        expect(Object.keys(s.byDate)).toEqual(['2026-03-05']);
        expect(s.totalRuns).toBe(1);
    });
});

describe('calcComparePeriod', () => {
    it('1일부터 보는 기간은 앞선 달의 같은 날짜와 비교한다 — 이번 달(10/1~10/15) → 9/1~9/15', () => {
        expect(calcComparePeriod('2026-10-01', '2026-10-15')).toEqual({ start: '2026-09-01', end: '2026-09-15' });
    });
    it('10/1 하루짜리 이번 달은 9/1과 비교한다 — 예전에는 9/30 하루와 비교했다', () => {
        expect(calcComparePeriod('2026-10-01', '2026-10-01')).toEqual({ start: '2026-09-01', end: '2026-09-01' });
    });
    it('지난 달 전체(9/1~9/30)는 8월 전체(8/1~8/31)와 비교한다 — 예전에는 8/1이 빠졌다', () => {
        expect(calcComparePeriod('2026-09-01', '2026-09-30')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    });
    it('최근 3개월(8/1~10/15)은 5/1~7/15와 비교한다', () => {
        expect(calcComparePeriod('2026-08-01', '2026-10-15')).toEqual({ start: '2026-05-01', end: '2026-07-15' });
    });
    it('앞선 달에 없는 날짜는 그 달 말일로 붙인다 — 3/1~3/31 → 2/1~2/28', () => {
        expect(calcComparePeriod('2026-03-01', '2026-03-31')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
        expect(calcComparePeriod('2026-03-01', '2026-03-30')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    });
    it('해를 넘긴다 — 1/1~1/10 → 전년 12/1~12/10', () => {
        expect(calcComparePeriod('2027-01-01', '2027-01-10')).toEqual({ start: '2026-12-01', end: '2026-12-10' });
    });
    it('1일이 아닌 날부터 고르면 바로 앞의 같은 길이 구간과 비교한다', () => {
        expect(calcComparePeriod('2026-03-05', '2026-03-15')).toEqual({ start: '2026-02-22', end: '2026-03-04' });
    });
});

describe('filterPrevPeriodLogs', () => {
    it('비교 구간(calcComparePeriod)의 기록만 남긴다', () => {
        const logs = [
            log({ id: 'in', date: '2026-02-05' }),
            log({ id: 'edge-start', date: '2026-02-01' }),
            log({ id: 'edge-end', date: '2026-02-11' }),
            log({ id: 'out-after', date: '2026-02-12' }),
            log({ id: 'out-before', date: '2026-01-31' }),
        ];
        // 3/1~3/11 → 2/1~2/11
        const ids = filterPrevPeriodLogs(logs, '2026-03-01', '2026-03-11').map(l => l.id);
        expect(ids.sort()).toEqual(['edge-end', 'edge-start', 'in']);
    });
});

describe('calcFuelStats', () => {
    it('기간 안의 주유만 합산하고 차량별로 비용 내림차순 정렬한다', () => {
        const r = calcFuelStats(
            [
                fuel({ id: 'a', vehicleName: '스타렉스', fuelCost: 10000, fuelAmount: 10 }),
                fuel({ id: 'b', vehicleName: '카니발', fuelCost: 50000, fuelAmount: 40 }),
                fuel({ id: 'c', vehicleName: '스타렉스', fuelCost: 5000, fuelAmount: 5 }),
                fuel({ id: 'out', date: '2026-04-01', fuelCost: 999999 }),
            ],
            '2026-03-01', '2026-03-31',
        );

        expect(r.count).toBe(3);
        expect(r.totalCost).toBe(65000);
        expect(r.amountByUnit).toEqual({ L: 55, kWh: 0, kg: 0 });
        expect(r.costByVehicleId).toEqual({ v1: 65000 });
        expect(r.vehicleData.map(v => v.name)).toEqual(['카니발', '스타렉스']);
        expect(r.vehicleData[1]).toMatchObject({ cost: 15000, amount: 15, count: 2 });
    });

    it('주유량은 연료 단위별로 따로 더한다 — L와 kWh를 합쳐 L를 붙이지 않는다', () => {
        const r = calcFuelStats(
            [
                fuel({ id: 'g', fuelType: 'gasoline', fuelAmount: 40 }),
                fuel({ id: 'e', fuelType: 'electric', fuelAmount: 25 }),
                fuel({ id: 'h', fuelType: 'hydrogen', fuelAmount: 5 }),
                fuel({ id: 'old', fuelAmount: 10 }), // 연료 종류가 없는 옛 기록은 L
            ],
            '2026-03-01', '2026-03-31',
        );
        expect(r.amountByUnit).toEqual({ L: 50, kWh: 25, kg: 5 });
    });

    it('차량명이 없으면 미지정으로 묶는다', () => {
        const r = calcFuelStats([fuel({ vehicleName: undefined })], '2026-03-01', '2026-03-31');
        expect(r.vehicleData[0].name).toBe('(미지정)');
    });
});

describe('calcHipassStats', () => {
    it('충전액을 합산하고 차량명이 없으면 카드번호로 묶는다', () => {
        const r = calcHipassStats(
            [
                hipass({ id: 'a', vehicleName: '스타렉스', chargeAmount: 30000 }),
                hipass({ id: 'b', vehicleName: undefined, cardNumber: '9999', chargeAmount: 10000 }),
            ],
            '2026-03-01', '2026-03-31',
        );

        expect(r.totalAmount).toBe(40000);
        expect(r.vehicleData.map(v => v.name)).toEqual(['스타렉스', '9999']);
    });
});

describe('calcCostTrend', () => {
    it('날짜별로 주유·하이패스를 합쳐 오름차순으로 낸다', () => {
        const r = calcCostTrend(
            [fuel({ date: '2026-03-06', fuelCost: 20000 }), fuel({ id: 'b', date: '2026-03-05', fuelCost: 10000 })],
            [hipass({ date: '2026-03-05', chargeAmount: 5000 })],
            '2026-03-01', '2026-03-31',
        );

        expect(r).toEqual([
            { date: '03-05', fuel: 10000, hipass: 5000, total: 15000 },
            { date: '03-06', fuel: 20000, hipass: 0, total: 20000 },
        ]);
    });

    it('하이패스만 있는 날도 항목으로 만든다', () => {
        const r = calcCostTrend([], [hipass({ date: '2026-03-07', chargeAmount: 3000 })], '2026-03-01', '2026-03-31');
        expect(r).toEqual([{ date: '03-07', fuel: 0, hipass: 3000, total: 3000 }]);
    });
});

describe('표시용 변환', () => {
    it('직원별 — 거리 내림차순 + 평균 거리', () => {
        expect(formatDriverData({ 갑: { count: 2, distance: 100 }, 을: { count: 1, distance: 300 } })).toEqual([
            { name: '을', distance: 300, count: 1, avgDistance: 300 },
            { name: '갑', distance: 100, count: 2, avgDistance: 50 },
        ]);
    });

    it('직원별 — 건수가 0이면 평균을 0으로 두고 나누지 않는다', () => {
        expect(formatDriverData({ 갑: { count: 0, distance: 0 } })[0].avgDistance).toBe(0);
    });

    it('차량별 — 주유비는 주유 기록에서 vehicleId로 가져오고, 없으면 0', () => {
        expect(formatVehicleData(
            { v1: { name: '카니발', count: 1, distance: 10 }, v2: { name: '레이', count: 2, distance: 30 } },
            { v1: 45000 },
        )).toEqual([
            { name: '레이', distance: 30, count: 2, fuel: 0 },
            { name: '카니발', distance: 10, count: 1, fuel: 45000 },
        ]);
    });

    it('목적별 — 건수 내림차순', () => {
        expect(formatPurposeData({ 출장: 1, 배송: 5 })).toEqual([
            { name: '배송', value: 5 },
            { name: '출장', value: 1 },
        ]);
    });

    it('일별 추이 — 날짜 오름차순 + MM-DD 표기', () => {
        expect(formatDailyTrendData({
            '2026-03-06': { count: 1, distance: 10 },
            '2026-03-05': { count: 2, distance: 20 },
        })).toEqual([
            { date: '03-05', count: 2, distance: 20 },
            { date: '03-06', count: 1, distance: 10 },
        ]);
    });
});
