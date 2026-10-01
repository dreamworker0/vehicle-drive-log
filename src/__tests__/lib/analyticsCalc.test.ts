/**
 * analyticsCalc — 야간 집계 문서를 화면 데이터로 바꾸는 계산 (트렌드 · 히트맵 · 이상 탐지 · 집계 시각)
 *
 * 예전 이 파일은 원본 일지를 받는 옛 함수(화면이 쓰지 않는다)를 시험했다. 지금은 `useAnalytics`가
 * 실제로 부르는 함수를 시험한다.
 */
import { describe, it, expect } from 'vitest';
import {
    countWorkdays,
    calcMonthlyTrend,
    calcDriveOriginTrend,
    calcDriveOriginBy,
    calcHeatmap,
    calcAnomalies,
    calcHipassUsedTotal,
    calcAggregatedAt,
    MONTH_LABELS,
    DAY_NAMES,
} from '../../hooks/utils/analyticsCalc';
import { stat, vstat } from './monthlyStatFixture';

const MONTHS = ['2026-07', '2026-08', '2026-09'];

describe('countWorkdays — 가동률 분모', () => {
    it('공휴일을 뺀다 — 2026년 9월 평일 22일 중 추석 연휴(9/24·25) 제외', () => {
        const holidays = new Set(['2026-09-24', '2026-09-25', '2026-09-26']); // 26일은 토요일
        expect(countWorkdays('2026-09', holidays, new Date(2026, 11, 31))).toBe(20);
    });
    it('진행 중인 달은 오늘까지만 센다 — 10/1(목)에 보면 10월은 1일', () => {
        expect(countWorkdays('2026-10', new Set(), new Date(2026, 9, 1, 9))).toBe(1);
    });
    it('지난 달은 한 달 전체, 앞으로의 달은 0', () => {
        expect(countWorkdays('2026-09', new Set(), new Date(2026, 9, 1))).toBe(22);
        expect(countWorkdays('2026-11', new Set(), new Date(2026, 9, 1))).toBe(0);
    });
});

describe('calcMonthlyTrend', () => {
    it('monthKeys 순서대로 건수·거리·주유비를 옮기고, 문서가 없는 달은 0', () => {
        const r = calcMonthlyTrend([
            stat('2026-09', { totalLogs: 12, totalDistance: 340, fuelCost: 90000 }),
            stat('2026-07', { totalLogs: 3, totalDistance: 50 }),
        ], MONTHS);
        expect(r).toEqual([
            { month: '2026-07', label: '7월', count: 3, distance: 50, fuelCost: 0 },
            { month: '2026-08', label: '8월', count: 0, distance: 0, fuelCost: 0 },
            { month: '2026-09', label: '9월', count: 12, distance: 340, fuelCost: 90000 },
        ]);
    });
});

describe('calcDriveOriginTrend', () => {
    it('월별 운행 방식 건수를 옮긴다', () => {
        const r = calcDriveOriginTrend([
            stat('2026-08', { originCounts: { reservation: 4, quick: 7, manual: 1, linked: 2 } }),
        ], MONTHS);
        expect(r[1]).toEqual({ month: '2026-08', label: '8월', reservation: 4, quick: 7, manual: 1, linked: 2 });
        expect(r[0]).toMatchObject({ reservation: 0, quick: 0, manual: 0, linked: 0 });
    });
});

describe('calcDriveOriginBy — 직원별·차량별 운행 방식', () => {
    const o = (reservation: number, quick: number, manual = 0, linked = 0) => ({ reservation, quick, manual, linked });

    it('기간 전체를 id로 합치고 최신 이름을 쓰며, 많은 순으로 낸다', () => {
        const r = calcDriveOriginBy([
            stat('2026-08', { driverStats: { u1: { name: '김옛이름', count: 2, distance: 0, origin: o(1, 1) } } }),
            stat('2026-09', {
                driverStats: {
                    u1: { name: '김새이름', count: 1, distance: 0, origin: o(0, 1) },
                    u2: { name: '이기사', count: 5, distance: 0, origin: o(2, 2, 1) },
                },
            }),
        ]);
        expect(r.byDriver.map(d => [d.name, d.total])).toEqual([['이기사', 5], ['김새이름', 3]]);
        expect(r.byDriver[1]).toMatchObject({ reservation: 1, quick: 2 });
    });

    it('origin이 없는 옛 문서는 건너뛰고, 합이 0인 줄은 뺀다', () => {
        const r = calcDriveOriginBy([
            stat('2026-08', { vehicleStats: { v1: vstat({ name: '스타렉스' }), v2: vstat({ name: '카니발', origin: o(0, 0) }) } }),
        ]);
        expect(r.byVehicle).toEqual([]);
    });

    it('상위 10곳까지만', () => {
        const driverStats = Object.fromEntries(Array.from({ length: 12 }, (_, i) =>
            [`u${i}`, { name: `직원${i}`, count: i + 1, distance: 0, origin: o(i + 1, 0) }]));
        expect(calcDriveOriginBy([stat('2026-09', { driverStats })]).byDriver).toHaveLength(10);
    });
});

describe('calcHeatmap', () => {
    it('달마다의 칸을 더하고, 범위 밖 칸은 버린다', () => {
        const r = calcHeatmap([
            stat('2026-08', { heatmapData: [{ dayIdx: 1, hour: 9, count: 2 }, { dayIdx: 7, hour: 9, count: 99 }] }),
            stat('2026-09', { heatmapData: [{ dayIdx: 1, hour: 9, count: 3 }, { dayIdx: 0, hour: 23, count: 1 }] }),
        ]);
        expect(r.grid).toHaveLength(7);
        expect(r.grid[0]).toHaveLength(24);
        expect(r.grid[1][9]).toBe(5);
        expect(r.items).toEqual([
            { day: '일', dayIdx: 0, hour: 23, count: 1 },
            { day: '월', dayIdx: 1, hour: 9, count: 5 },
        ]);
        expect(r.maxCount).toBe(5);
    });

    it('자료가 없어도 maxCount는 1 — 색 계산에서 0으로 나누지 않게', () => {
        expect(calcHeatmap([]).maxCount).toBe(1);
    });
});

describe('calcAnomalies — 기간 합계로 판정', () => {
    const at = (totalLogs: number, weekend: number, night: number, overDrive: number) =>
        calcAnomalies([stat('2026-09', { totalLogs, anomalies: { weekend, night, overDrive } })]);

    it('주말 비율 15% 초과부터, 30% 초과는 높음', () => {
        expect(at(100, 15, 0, 0)).toEqual([]);
        expect(at(100, 16, 0, 0)[0]).toMatchObject({ type: 'weekend', severity: 'medium', title: '주말 운행 비율 16%' });
        expect(at(100, 31, 0, 0)[0]).toMatchObject({ severity: 'high' });
    });

    it('심야 3건 초과부터, 10건 초과는 높음', () => {
        expect(at(100, 0, 3, 0)).toEqual([]);
        expect(at(100, 0, 4, 0)[0]).toMatchObject({ type: 'night', severity: 'medium' });
        expect(at(100, 0, 11, 0)[0]).toMatchObject({ severity: 'high' });
    });

    it('하루 200km 초과는 1건부터, 5건 초과는 높음', () => {
        expect(at(100, 0, 0, 1)[0]).toMatchObject({ type: 'overdrive', severity: 'low' });
        expect(at(100, 0, 0, 6)[0]).toMatchObject({ severity: 'high' });
    });

    it('여러 달을 더해서 본다 — 한 달씩은 기준 아래여도', () => {
        const r = calcAnomalies([
            stat('2026-08', { totalLogs: 10, anomalies: { weekend: 0, night: 2, overDrive: 0 } }),
            stat('2026-09', { totalLogs: 10, anomalies: { weekend: 0, night: 2, overDrive: 0 } }),
        ]);
        expect(r.map(a => a.type)).toEqual(['night']);
    });

    it('운행이 없으면 빈 배열', () => {
        expect(calcAnomalies([])).toEqual([]);
    });
});

describe('calcHipassUsedTotal', () => {
    it('기간 안의 달만 더한다', () => {
        expect(calcHipassUsedTotal([
            stat('2026-08', { hipassUsed: 1000 }),
            stat('2026-09', { hipassUsed: 2500 }),
            stat('2026-01', { hipassUsed: 99999 }),
        ], MONTHS)).toBe(3500);
    });

    it('사용액을 담은 달이 하나도 없으면 null — 0원 사용과 구분한다', () => {
        expect(calcHipassUsedTotal([stat('2026-09')], MONTHS)).toBeNull();
        expect(calcHipassUsedTotal([stat('2026-09', { hipassUsed: 0 })], MONTHS)).toBe(0);
    });
});

describe('calcAggregatedAt', () => {
    it('가장 최근 집계 시각, 없으면 null', () => {
        const a = new Date('2026-09-30T02:10:00+09:00');
        const b = new Date('2026-10-01T02:14:00+09:00');
        expect(calcAggregatedAt([stat('2026-09', { updatedAt: a }), stat('2026-10', { updatedAt: b })])).toEqual(b);
        expect(calcAggregatedAt([stat('2026-09')])).toBeNull();
    });
});

describe('상수', () => {
    it('MONTH_LABELS는 12개월, DAY_NAMES는 일요일부터 7요일', () => {
        expect(MONTH_LABELS).toHaveLength(12);
        expect(MONTH_LABELS[0]).toBe('1월');
        expect(DAY_NAMES).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    });
});
