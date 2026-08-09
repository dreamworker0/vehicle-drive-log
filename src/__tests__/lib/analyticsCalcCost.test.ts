/**
 * analyticsCalc — 비용·가동률·추천 계산 테스트
 *
 * 기존 analyticsCalc.test.ts는 월별 추이·히트맵·이상 탐지까지만 덮고 있었다. 이 파일은
 * 관리자 [분석] 화면 아래쪽 절반(직원 비교·가동률·연비·정비비·비용 추이·추천 카드)을 덮는다.
 *
 * 추천 카드는 특히 임계값이 촘촘하다(평균 대비 1.3배, 전월 대비 1.5배 + 최소 5건, 90/180일,
 * 가동률 10% + 근무일 20일). 임계 바로 아래에서 뜨거나 바로 위에서 안 뜨면 관리자에게
 * 근거 없는 지시가 나가므로 경계값을 함께 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    calcDriverComparison,
    calcVehicleUtilization,
    calcFuelEfficiency,
    calcMaintenanceCostAnalysis,
    calcCostTrend,
    calcRecommendations,
    detectAnomalies,
    type LogEntry,
} from '../../hooks/utils/analyticsCalc';

const MONTHS = ['2026-01', '2026-02', '2026-03'];

describe('calcDriverComparison', () => {
    const logs: LogEntry[] = [
        { date: '2026-02-10', driverName: '홍길동', startKm: 0, endKm: 100 },
        { date: '2026-03-10', driverName: '홍길동', startKm: 0, endKm: 50 },
        { date: '2026-03-11', driverName: '김철수', startKm: 0, endKm: 30 },
    ];

    it('최근 3개월만 보고 운행 건수 내림차순으로 낸다', () => {
        const r = calcDriverComparison(logs, MONTHS);
        expect(r.map(d => d.name)).toEqual(['홍길동', '김철수']);
        expect(r[0].totalCount).toBe(2);
        expect(r[0].totalDistance).toBe(150);
    });

    it('월 라벨별 건수·거리를 펼쳐 담는다 (차트가 이 키를 읽는다)', () => {
        const r = calcDriverComparison(logs, MONTHS) as unknown as Record<string, number | string[]>[];
        expect(r[0]['2월_count']).toBe(1);
        expect(r[0]['3월_distance']).toBe(50);
        expect(r[0]['1월_count']).toBe(0); // 기록이 없는 달도 0으로 채운다
        expect(r[0].monthLabels).toEqual(['1월', '2월', '3월']);
    });

    it('최근 3개월 밖의 기록은 세지 않는다', () => {
        expect(calcDriverComparison([{ date: '2025-12-01', driverName: '홍길동' }], MONTHS)).toEqual([]);
    });

    it('운전자명이 없으면 (이름 없음)으로 묶는다', () => {
        expect(calcDriverComparison([{ date: '2026-03-01' }], MONTHS)[0].name).toBe('(이름 없음)');
    });

    it('날짜를 알 수 없는 기록은 건너뛴다', () => {
        expect(calcDriverComparison([{ driverName: '홍길동' }], MONTHS)).toEqual([]);
    });
});

describe('calcVehicleUtilization', () => {
    const vehicles = [
        { id: 'v1', displayName: '카니발' },
        { id: 'v2', displayName: '스타렉스' },
    ];

    it('같은 날 여러 번 써도 하루로 세고, 가동률 내림차순으로 낸다', () => {
        const r = calcVehicleUtilization(
            [
                { date: '2026-03-02', vehicleDisplayName: '카니발' },
                { date: '2026-03-02', vehicleDisplayName: '카니발' },
                { date: '2026-03-03', vehicleDisplayName: '카니발' },
            ],
            vehicles,
            MONTHS,
        );

        expect(r[0].name).toBe('카니발');
        expect(r[0].usedDays).toBe(2);
        expect(r[1]).toMatchObject({ name: '스타렉스', usedDays: 0, rate: 0 });
        expect(r[0].totalWorkdays).toBeGreaterThan(0);
        expect(r[0].rate).toBe(Math.round((2 / r[0].totalWorkdays) * 100));
    });

    it('차량 이름은 displayName → plateNumber → (미지정) 순으로 정한다', () => {
        const r = calcVehicleUtilization([], [{ id: 'v1', plateNumber: '12가3456' }, { id: 'v2' }], MONTHS);
        expect(r.map(v => v.name).sort()).toEqual(['(미지정)', '12가3456']);
    });

    it('대상 기간이 없으면 0으로 나누지 않는다', () => {
        const r = calcVehicleUtilization([], vehicles, []);
        expect(r.every(v => v.rate === 0 && v.totalWorkdays === 0)).toBe(true);
    });
});

describe('calcFuelEfficiency', () => {
    it('차량별 km당 연료비를 내고 비싼 순으로 정렬한다', () => {
        const r = calcFuelEfficiency([
            { vehicleDisplayName: '카니발', startKm: 0, endKm: 100, fuelAmount: 1000 },
            { vehicleDisplayName: '스타렉스', startKm: 0, endKm: 100, fuelAmount: 2000 },
        ]);

        expect(r.items.map(i => i.name)).toEqual(['스타렉스', '카니발']);
        expect(r.items[0].costPerKm).toBe(20);
        expect(r.items[1].costPerKm).toBe(10);
        expect(r.avgCostPerKm).toBe(15);
    });

    it('거리가 0 이하인 기록은 빼고 계산한다 — 미완료 일지가 연비를 왜곡하지 않게', () => {
        const r = calcFuelEfficiency([
            { vehicleDisplayName: '카니발', startKm: 100, endKm: 100, fuelAmount: 9999 },
            { vehicleDisplayName: '카니발', startKm: 0, endKm: 100, fuelAmount: 1000 },
        ]);
        expect(r.items).toHaveLength(1);
        expect(r.items[0].costPerKm).toBe(10);
    });

    it('연료비가 없는 차량은 목록에서 뺀다', () => {
        const r = calcFuelEfficiency([{ vehicleName: '카니발', startKm: 0, endKm: 100 }]);
        expect(r.items).toEqual([]);
        expect(r.avgCostPerKm).toBe(0);
    });

    it('전기차 충전요금(energyCost)도 연료비로 본다', () => {
        const r = calcFuelEfficiency([{ vehicleName: '아이오닉', startKm: 0, endKm: 100, energyCost: 500 }]);
        expect(r.items[0].costPerKm).toBe(5);
    });
});

describe('calcMaintenanceCostAnalysis', () => {
    it('차량별 정비비 합계·건수·마지막 정비일을 내고 비용 내림차순으로 낸다', () => {
        const r = calcMaintenanceCostAnalysis(
            [{ id: 'v1', displayName: '카니발', currentKm: 10000 }, { id: 'v2', displayName: '스타렉스' }],
            [
                { vehicleName: '카니발', cost: 100000, date: '2026-01-05' },
                { vehicleName: '카니발', cost: 50000, date: '2026-03-05' },
            ],
        );

        expect(r[0]).toMatchObject({
            name: '카니발',
            totalMaintenanceCost: 150000,
            maintenanceCount: 2,
            lastMaintenanceDate: '2026-03-05',
            costPerKm: 15,
        });
        expect(r[1]).toMatchObject({ name: '스타렉스', totalMaintenanceCost: 0, costPerKm: 0 });
    });

    it('누적 거리가 0이면 km당 비용을 0으로 두고 나누지 않는다', () => {
        const r = calcMaintenanceCostAnalysis(
            [{ id: 'v1', displayName: '카니발' }],
            [{ vehicleName: '카니발', cost: 100000, date: '2026-01-05' }],
        );
        expect(r[0].costPerKm).toBe(0);
    });
});

describe('calcCostTrend', () => {
    it('월별로 주유·하이패스·정비비를 더해 총액을 낸다', () => {
        const r = calcCostTrend(
            [{ date: '2026-02-10', fuelCost: 50000 }],
            [{ date: '2026-02-11', chargeAmount: 10000 }],
            [{ date: '2026-03-01', cost: 200000 }],
            MONTHS,
        );

        expect(r).toHaveLength(3);
        expect(r[0]).toMatchObject({ label: '1월', totalCost: 0 });
        expect(r[1]).toMatchObject({ label: '2월', fuelCost: 50000, hipassCost: 10000, totalCost: 60000 });
        expect(r[2]).toMatchObject({ label: '3월', maintenanceCost: 200000, totalCost: 200000 });
    });

    it('대상 월 밖이거나 날짜가 없는 기록은 세지 않는다', () => {
        const r = calcCostTrend(
            [{ date: '2025-12-01', fuelCost: 99999 }, { fuelCost: 88888 }],
            [{ date: '2025-12-01', chargeAmount: 99999 }, { chargeAmount: 88888 }],
            [{ date: '2025-12-01', cost: 99999 }],
            MONTHS,
        );
        expect(r.every(m => m.totalCost === 0)).toBe(true);
    });
});

describe('calcRecommendations', () => {
    const empty = {
        fuelEfficiency: { items: [], avgCostPerKm: 0 },
        driverComparison: [],
        maintenanceCostAnalysis: [],
        anomalies: [],
        vehicleUtilization: [],
        monthKeys: MONTHS,
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T00:00:00+09:00'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('추천할 것이 없으면 빈 배열', () => {
        expect(calcRecommendations(empty)).toEqual([]);
    });

    it('평균보다 30%를 넘게 비싼 차량만 연료 경고를 낸다', () => {
        const under = calcRecommendations({
            ...empty,
            fuelEfficiency: {
                avgCostPerKm: 100,
                items: [{ name: '카니발', totalDist: 100, totalCost: 13000, costPerKm: 130 }],
            },
        });
        expect(under).toEqual([]); // 정확히 1.3배는 아직 아니다

        const over = calcRecommendations({
            ...empty,
            fuelEfficiency: {
                avgCostPerKm: 100,
                items: [{ name: '카니발', totalDist: 100, totalCost: 14000, costPerKm: 140 }],
            },
        });
        expect(over[0]).toMatchObject({ type: 'fuel', priority: 'high' });
        expect(over[0].desc).toContain('40%');
    });

    it('전월 5건 이상이면서 1.5배를 넘게 늘어난 직원만 급증으로 본다', () => {
        const driver = (febCount: number, marCount: number) => ([{
            name: '홍길동', totalCount: febCount + marCount, totalDistance: 0,
            '2월_count': febCount, '3월_count': marCount,
        }] as unknown as Parameters<typeof calcRecommendations>[0]['driverComparison']);

        expect(calcRecommendations({ ...empty, driverComparison: driver(4, 40) })).toEqual([]); // 전월 5건 미만
        expect(calcRecommendations({ ...empty, driverComparison: driver(10, 15) })).toEqual([]); // 정확히 1.5배는 아직 아니다

        const hit = calcRecommendations({ ...empty, driverComparison: driver(10, 20) });
        expect(hit[0]).toMatchObject({ type: 'driver_increase', priority: 'medium' });
        expect(hit[0].desc).toContain('100%');
    });

    it('마지막 정비 후 90일이 지나면 권장, 180일이 지나면 높은 우선순위', () => {
        const mk = (lastMaintenanceDate: string) => ([{
            name: '카니발', totalMaintenanceCost: 0, maintenanceCount: 1,
            lastMaintenanceDate, currentKm: 10000, costPerKm: 0,
        }]);

        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: mk('2026-05-01') })).toEqual([]);
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: mk('2026-02-01') })[0])
            .toMatchObject({ type: 'maintenance', priority: 'medium' });
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: mk('2025-06-01') })[0])
            .toMatchObject({ type: 'maintenance', priority: 'high' });
    });

    it('정비 이력이나 누적 거리가 없는 차량은 정비 권장을 만들지 않는다', () => {
        expect(calcRecommendations({
            ...empty,
            maintenanceCostAnalysis: [
                { name: 'A', totalMaintenanceCost: 0, maintenanceCount: 0, lastMaintenanceDate: '', currentKm: 100, costPerKm: 0 },
                { name: 'B', totalMaintenanceCost: 0, maintenanceCount: 1, lastMaintenanceDate: '2020-01-01', currentKm: 0, costPerKm: 0 },
            ],
        })).toEqual([]);
    });

    it('주말 운행 경고가 있으면 정책 검토 카드를 만든다', () => {
        const anomalies = detectAnomalies([
            { date: '2026-03-07', startKm: 0, endKm: 10 }, // 토
            { date: '2026-03-02', startKm: 0, endKm: 10 }, // 월
        ]);
        const r = calcRecommendations({ ...empty, anomalies });
        expect(r.find(i => i.type === 'policy')).toBeTruthy();
    });

    it('근무일이 20일을 넘는 기간에서 가동률 10% 미만인 차량만 저활용으로 본다', () => {
        expect(calcRecommendations({
            ...empty,
            vehicleUtilization: [{ name: 'A', usedDays: 1, totalWorkdays: 20, rate: 5 }],
        })).toEqual([]); // 기간이 짧으면 판단하지 않는다

        const r = calcRecommendations({
            ...empty,
            vehicleUtilization: [
                { name: 'A', usedDays: 1, totalWorkdays: 60, rate: 2 },
                { name: 'B', usedDays: 30, totalWorkdays: 60, rate: 50 },
            ],
        });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ type: 'underuse', priority: 'low' });
    });

    it('높은 우선순위가 앞에 오도록 정렬한다', () => {
        const r = calcRecommendations({
            ...empty,
            fuelEfficiency: { avgCostPerKm: 100, items: [{ name: 'A', totalDist: 1, totalCost: 200, costPerKm: 200 }] },
            vehicleUtilization: [{ name: 'B', usedDays: 1, totalWorkdays: 60, rate: 2 }],
        });
        expect(r.map(i => i.priority)).toEqual(['high', 'low']);
    });
});
