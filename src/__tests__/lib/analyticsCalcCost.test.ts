/**
 * analyticsCalc — 비용·가동률·추천 계산 테스트
 *
 * 관리자 [분석] 화면 아래쪽 절반(직원 비교·가동률·연비·정비비·비용 추이·추천 카드)을 덮는다.
 * 입력은 화면과 같은 **야간 집계 문서(MonthlyStat)** 다 — 예전에는 화면이 쓰지 않는 원본 일지용
 * 옛 함수를 시험해, 통과해도 화면 숫자가 맞다는 보장이 없었다.
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
    calcMonthOverMonth,
    calcAnomalies,
} from '../../hooks/utils/analyticsCalc';
import { stat, vstat, vehicle } from './monthlyStatFixture';

const MONTHS = ['2026-01', '2026-02', '2026-03'];

describe('calcDriverComparison — 최근 3개월', () => {
    const d = (name: string | undefined, count: number, distance: number) => ({ name, count, distance });

    it('uid로 묶어 운행 건수 내림차순으로 내고, 월 라벨별 건수·거리를 펼친다(차트가 이 키를 읽는다)', () => {
        const r = calcDriverComparison([
            stat('2026-02', { driverStats: { u1: d('홍길동', 1, 100) } }),
            stat('2026-03', { driverStats: { u1: d('홍길동', 1, 50), u2: d('김철수', 1, 30) } }),
        ], MONTHS) as unknown as Record<string, number | string | string[]>[];
        expect(r.map(x => x.name)).toEqual(['홍길동', '김철수']);
        expect(r[0]).toMatchObject({ totalCount: 2, totalDistance: 150, '2월_count': 1, '3월_distance': 50, '1월_count': 0 });
        expect(r[0].monthLabels).toEqual(['1월', '2월', '3월']);
    });

    it('최근 3개월 밖의 달은 세지 않는다', () => {
        expect(calcDriverComparison([stat('2025-12', { driverStats: { u1: d('홍길동', 9, 9) } })], MONTHS)).toEqual([]);
    });

    it('이름을 바꾼 사람은 한 줄(최신 이름), 동명이인은 번호로 가른다', () => {
        const r = calcDriverComparison([
            stat('2026-02', { driverStats: { u1: d('김옛이름', 1, 0) } }),
            stat('2026-03', { driverStats: { u1: d('김새이름', 3, 0), u2: d('이민수', 2, 0), u3: d('이민수', 1, 0) } }),
        ], MONTHS);
        expect(r.map(x => x.name)).toEqual(['김새이름', '이민수', '이민수 (2)']);
    });

    it('이름이 없으면 알 수 없음', () => {
        expect(calcDriverComparison([stat('2026-03', { driverStats: { u1: d(undefined, 1, 0) } })], MONTHS)[0].name).toBe('알 수 없음');
    });
});

describe('calcVehicleUtilization — 최근 3개월 가동률', () => {
    // 2026-03-31(화) 기준: 1월 22 · 2월 20 · 3월 22 평일 = 64
    const UNTIL = new Date(2026, 2, 31, 12);

    it('가동일 합 ÷ 평일(공휴일 제외) 수, 가동률 내림차순', () => {
        const r = calcVehicleUtilization(
            [stat('2026-02', { vehicleStats: { a: vstat({ usedDays: 10 }) } }), stat('2026-03', { vehicleStats: { a: vstat({ usedDays: 6 }), b: vstat({ usedDays: 32 }) } })],
            [vehicle('a', { displayName: '스타렉스' }), vehicle('b', { displayName: '카니발' })],
            MONTHS, new Set(['2026-03-02']), UNTIL,
        );
        expect(r).toEqual([
            { name: '카니발', usedDays: 32, totalWorkdays: 63, rate: 51 },
            { name: '스타렉스', usedDays: 16, totalWorkdays: 63, rate: 25 },
        ]);
    });

    it('주말 운행으로 분모를 넘어도 100%에서 멈춘다', () => {
        const r = calcVehicleUtilization([stat('2026-03', { vehicleStats: { a: vstat({ usedDays: 99 }) } })], [vehicle('a')], MONTHS, new Set(), UNTIL);
        expect(r[0].rate).toBe(100);
    });

    it('차량 이름은 displayName → plateNumber → (미지정), 기록이 없으면 0%', () => {
        const r = calcVehicleUtilization([], [vehicle('a', { plateNumber: '12가3456' }), vehicle('b', { plateNumber: '' })], MONTHS, new Set(), UNTIL);
        expect(r.map(v => [v.name, v.rate])).toEqual([['12가3456', 0], ['(미지정)', 0]]);
    });

    it('대상 기간에 평일이 없으면 0으로 나누지 않는다', () => {
        const r = calcVehicleUtilization([], [vehicle('a')], ['2027-01'], new Set(), UNTIL);
        expect(r[0]).toMatchObject({ totalWorkdays: 0, rate: 0 });
    });
});

describe('calcFuelEfficiency', () => {
    it('차량별로 달을 더해 km당 연료비를 내고 비싼 순, 평균은 차량 평균', () => {
        const r = calcFuelEfficiency([
            stat('2026-02', { vehicleStats: { a: vstat({ name: '스타렉스', totalDist: 100, totalCost: 10000 }) } }),
            stat('2026-03', { vehicleStats: { a: vstat({ totalDist: 100, totalCost: 20000 }), b: vstat({ name: '카니발', totalDist: 400, totalCost: 40000 }) } }),
        ]);
        expect(r.items.map(i => [i.name, i.costPerKm])).toEqual([['스타렉스', 150], ['카니발', 100]]);
        expect(r.avgCostPerKm).toBe(125);
    });

    it('거리나 연료비가 없는 차량은 뺀다', () => {
        const r = calcFuelEfficiency([stat('2026-03', { vehicleStats: { a: vstat({ totalDist: 100 }), b: vstat({ totalCost: 5000 }) } })]);
        expect(r).toEqual({ items: [], avgCostPerKm: 0 });
    });
});

describe('calcMaintenanceCostAnalysis', () => {
    it('차량별 정비비 합·건수·마지막 정비일과 보험 만료일·운행 중지 여부를 담고, 비용 내림차순', () => {
        const r = calcMaintenanceCostAnalysis(
            [
                stat('2026-02', { vehicleStats: { a: vstat({ maintenanceCost: 50000, maintenanceCount: 1, lastMaintenanceDate: '2026-02-10' }) } }),
                stat('2026-03', { vehicleStats: { a: vstat({ maintenanceCost: 150000, maintenanceCount: 1, lastMaintenanceDate: '2026-03-05' }) } }),
            ],
            [
                vehicle('b', { displayName: '카니발', currentKm: 1000, retired: { isRetired: true, reason: '', retiredAt: null } as never }),
                vehicle('a', { displayName: '스타렉스', currentKm: 20000, insurance: { company: '', phone: '', expiryDate: '2026-04-01' } }),
            ],
        );
        expect(r[0]).toMatchObject({
            name: '스타렉스', totalMaintenanceCost: 200000, maintenanceCount: 2, lastMaintenanceDate: '2026-03-05',
            costPerKm: 10, insuranceExpiryDate: '2026-04-01', retired: false,
        });
        expect(r[1]).toMatchObject({ name: '카니발', totalMaintenanceCost: 0, maintenanceCount: 0, lastMaintenanceDate: '', retired: true });
    });

    it('누적 거리가 0이면 km당 비용을 0으로 두고 나누지 않는다', () => {
        const r = calcMaintenanceCostAnalysis([stat('2026-03', { vehicleStats: { a: vstat({ maintenanceCost: 1000, maintenanceCount: 1 }) } })], [vehicle('a')]);
        expect(r[0].costPerKm).toBe(0);
    });
});

describe('calcCostTrend', () => {
    it('월별로 주유·하이패스(충전액)·정비비를 더해 총액을 내고, 문서가 없는 달은 0', () => {
        const r = calcCostTrend([stat('2026-02', { fuelCost: 100, hipassCost: 20, maintenanceCost: 3 })], MONTHS);
        expect(r).toEqual([
            { label: '1월', fuelCost: 0, hipassCost: 0, maintenanceCost: 0, totalCost: 0 },
            { label: '2월', fuelCost: 100, hipassCost: 20, maintenanceCost: 3, totalCost: 123 },
            { label: '3월', fuelCost: 0, hipassCost: 0, maintenanceCost: 0, totalCost: 0 },
        ]);
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
        const anomalies = calcAnomalies([stat('2026-03', { totalLogs: 2, anomalies: { weekend: 1, night: 0, overDrive: 0 } })]);
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

describe('calcRecommendations — 보험 만료 · 기간 내 정비 기록 없음', () => {
    const empty = {
        fuelEfficiency: { items: [], avgCostPerKm: 0 },
        driverComparison: [],
        maintenanceCostAnalysis: [],
        anomalies: [],
        vehicleUtilization: [],
        monthKeys: MONTHS,
    };
    const veh = (over: Partial<Parameters<typeof calcRecommendations>[0]['maintenanceCostAnalysis'][number]> = {}) => ({
        name: '카니발', totalMaintenanceCost: 0, maintenanceCount: 0, lastMaintenanceDate: '',
        currentKm: 10000, costPerKm: 0, ...over,
    });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T10:00:00+09:00'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('보험 만료 30일 안이면 알리고, 7일 안·만료는 높은 우선순위', () => {
        const at = (insuranceExpiryDate: string) => calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh({ insuranceExpiryDate })] });

        expect(at('2026-07-02')).toEqual([]); // 31일 뒤
        expect(at('2026-07-01')[0]).toMatchObject({ type: 'insurance', priority: 'medium', title: '카니발 보험 만료 D-30' });
        expect(at('2026-06-09')[0]).toMatchObject({ priority: 'medium', title: '카니발 보험 만료 D-8' });
        expect(at('2026-06-08')[0]).toMatchObject({ priority: 'high', title: '카니발 보험 만료 D-7' });
    });

    it('7일 안·오늘·이미 만료', () => {
        const at = (insuranceExpiryDate: string) => calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh({ insuranceExpiryDate })] })[0];

        expect(at('2026-06-07')).toMatchObject({ priority: 'high', title: '카니발 보험 만료 D-6' });
        expect(at('2026-06-01')).toMatchObject({ priority: 'high', title: '카니발 보험 만료 오늘' });
        expect(at('2026-05-20')).toMatchObject({ priority: 'high', title: '카니발 보험 만료됨' });
        expect(at('2026-05-20').desc).toContain('[차량 관리]');
    });

    it('만료일이 없거나 깨졌으면, 또는 운행을 중지한 차량이면 알리지 않는다', () => {
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh({ insuranceExpiryDate: '' })] })).toEqual([]);
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh({ insuranceExpiryDate: '2026/06/03' })] })).toEqual([]);
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh({ insuranceExpiryDate: '2026-06-03', retired: true })] })).toEqual([]);
    });

    it('정비를 기록하는 기관에서, 6개월 이상 기간에 정비가 한 건도 없는 차량을 알린다', () => {
        const fleet = [veh({ name: '스타렉스', maintenanceCount: 1, lastMaintenanceDate: '2026-05-20' }), veh({ name: '카니발' })];

        const r = calcRecommendations({ ...empty, maintenanceCostAnalysis: fleet, rangeMonths: 6 });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ type: 'maintenance', priority: 'medium', title: '카니발 정비 기록 없음' });
        expect(r[0].desc).toContain('6개월');
    });

    it('기간이 짧거나(3개월), 정비 기록을 아예 쓰지 않는 기관이거나, 운행 기록이 없는 차량이면 알리지 않는다', () => {
        const fleet = [veh({ name: '스타렉스', maintenanceCount: 1, lastMaintenanceDate: '2026-05-20' }), veh({ name: '카니발' })];
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: fleet, rangeMonths: 3 })).toEqual([]);
        expect(calcRecommendations({ ...empty, maintenanceCostAnalysis: [veh(), veh({ name: 'B' })], rangeMonths: 12 })).toEqual([]);
        expect(calcRecommendations({
            ...empty, rangeMonths: 12,
            maintenanceCostAnalysis: [fleet[0], veh({ name: '새차', currentKm: 0 })],
        })).toEqual([]);
        expect(calcRecommendations({
            ...empty, rangeMonths: 12,
            maintenanceCostAnalysis: [fleet[0], veh({ name: '퇴역', retired: true })],
        })).toEqual([]);
    });
});

describe('calcMonthOverMonth — 지난달과 그 전달', () => {
    const row = (month: string, count: number, distance: number, cost: number) => ({ month, count, distance, cost });

    it('진행 중인 이번 달이 아니라 지난달을 그 전달과 견준다', () => {
        const r = calcMonthOverMonth([
            row('2026-07', 1, 1, 1),
            row('2026-08', 100, 2000, 500000),
            row('2026-09', 120, 1800, 500000),
            row('2026-10', 3, 40, 0), // 이번 달(진행 중) — 비교에 쓰지 않는다
        ]);
        expect(r).toMatchObject({ label: '9월', prevLabel: '8월' });
        expect(r!.metrics.map(m => [m.key, m.cur, m.prev, m.pct])).toEqual([
            ['count', 120, 100, 20],
            ['distance', 1800, 2000, -10],
            ['cost', 500000, 500000, 0],
        ]);
    });

    it('전달 값이 0이면 증감률은 null', () => {
        const r = calcMonthOverMonth([row('2026-08', 0, 0, 0), row('2026-09', 5, 50, 0), row('2026-10', 0, 0, 0)]);
        expect(r!.metrics[0]).toMatchObject({ cur: 5, prev: 0, pct: null });
    });

    it('비교할 두 달이 모두 비었거나 기간이 3개월보다 짧으면 null', () => {
        expect(calcMonthOverMonth([row('2026-08', 0, 0, 0), row('2026-09', 0, 0, 0), row('2026-10', 9, 9, 9)])).toBeNull();
        expect(calcMonthOverMonth([row('2026-09', 5, 5, 5), row('2026-10', 5, 5, 5)])).toBeNull();
    });
});
