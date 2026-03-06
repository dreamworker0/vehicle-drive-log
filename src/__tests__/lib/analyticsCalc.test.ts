/**
 * analyticsCalc 단위 테스트
 * 월별 추이, 히트맵, 비정상 탐지 계산 함수 검증
 */
import { describe, it, expect } from 'vitest';
import {
    formatMonth,
    getLogDate,
    getWorkdaysInMonth,
    calcMonthlyTrend,
    calcHeatmapData,
    detectAnomalies,
    MONTH_LABELS,
    DAY_NAMES,
} from '../../hooks/utils/analyticsCalc';

describe('analyticsCalc', () => {
    describe('formatMonth', () => {
        it('Date를 YYYY-MM 포맷으로 변환한다', () => {
            expect(formatMonth(new Date(2026, 1, 27))).toBe('2026-02');
            expect(formatMonth(new Date(2026, 11, 1))).toBe('2026-12');
        });

        it('한 자리 월은 0으로 패딩한다', () => {
            expect(formatMonth(new Date(2026, 0, 1))).toBe('2026-01');
        });
    });

    describe('getLogDate', () => {
        it('date 필드가 있으면 그대로 반환한다', () => {
            expect(getLogDate({ date: '2026-02-27' })).toBe('2026-02-27');
        });

        it('date 없고 timestamp도 없으면 빈 문자열', () => {
            expect(getLogDate({})).toBe('');
        });
    });

    describe('getWorkdaysInMonth', () => {
        it('2026-02의 근무일을 정확히 계산한다', () => {
            // 2026-02: 28일, 일: 1,8,15,22 / 토: 7,14,21,28 → 주말 8일 → 근무일 20일
            expect(getWorkdaysInMonth('2026-02')).toBe(20);
        });

        it('2026-01의 근무일을 정확히 계산한다', () => {
            // 2026-01: 31일
            const result = getWorkdaysInMonth('2026-01');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThanOrEqual(23); // 최대 23 근무일
        });
    });

    describe('calcMonthlyTrend', () => {
        const monthKeys = ['2026-01', '2026-02'];
        const logs = [
            { date: '2026-01-15', startKm: 100, endKm: 150, fuelAmount: 30 },
            { date: '2026-01-20', startKm: 150, endKm: 200, fuelAmount: 25 },
            { date: '2026-02-10', startKm: 200, endKm: 350, fuelAmount: 50 },
        ];

        it('월별 운행 횟수를 올바르게 합산한다', () => {
            const result = calcMonthlyTrend(logs, monthKeys);
            expect(result[0].count).toBe(2); // 1월: 2건
            expect(result[1].count).toBe(1); // 2월: 1건
        });

        it('월별 주행거리를 올바르게 합산한다', () => {
            const result = calcMonthlyTrend(logs, monthKeys);
            expect(result[0].distance).toBe(100); // 1월: 50+50
            expect(result[1].distance).toBe(150); // 2월: 150
        });

        it('월별 연료비를 올바르게 합산한다', () => {
            const result = calcMonthlyTrend(logs, monthKeys);
            expect(result[0].fuelCost).toBe(55); // 1월: 30+25
            expect(result[1].fuelCost).toBe(50); // 2월: 50
        });

        it('월 라벨을 올바르게 생성한다', () => {
            const result = calcMonthlyTrend(logs, monthKeys);
            expect(result[0].label).toBe('1월');
            expect(result[1].label).toBe('2월');
        });

        it('로그가 없는 월은 0으로 초기화된다', () => {
            const result = calcMonthlyTrend([], monthKeys);
            expect(result[0].count).toBe(0);
            expect(result[0].distance).toBe(0);
        });
    });

    describe('calcHeatmapData', () => {
        const logs = [
            { date: '2026-02-23', startTime: '09:00' }, // 월
            { date: '2026-02-23', startTime: '09:30' }, // 월 09시대
            { date: '2026-02-24', startTime: '14:00' }, // 화
        ];

        it('히트맵 그리드를 7×24로 생성한다', () => {
            const result = calcHeatmapData(logs);
            expect(result.grid.length).toBe(7);
            expect(result.grid[0].length).toBe(24);
        });

        it('같은 요일/시간대의 건수를 합산한다', () => {
            const result = calcHeatmapData(logs);
            // 월요일(1) 09시에 2건
            expect(result.grid[1][9]).toBe(2);
        });

        it('최대 건수를 올바르게 계산한다', () => {
            const result = calcHeatmapData(logs);
            expect(result.maxCount).toBe(2);
        });

        it('빈 로그에서도 정상 동작한다', () => {
            const result = calcHeatmapData([]);
            expect(result.items.length).toBe(0);
            expect(result.maxCount).toBe(1); // 최소값 1
        });
    });

    describe('detectAnomalies', () => {
        it('주말 운행 비율이 15% 초과이면 경고를 생성한다', () => {
            // 10건 중 2건 주말 (20%) → 경고 발생
            const logs = [
                ...Array(8).fill(null).map(() => ({ date: '2026-02-23', startKm: 0, endKm: 10, driverName: 'A' })), // 월요일
                { date: '2026-02-22', startKm: 0, endKm: 10, driverName: 'A' }, // 일요일
                { date: '2026-02-28', startKm: 0, endKm: 10, driverName: 'A' }, // 토요일
            ];
            const result = detectAnomalies(logs);
            expect(result.find(a => a.type === 'weekend')).toBeTruthy();
        });

        it('심야 운행이 3건 초과이면 경고를 생성한다', () => {
            const logs = Array(5).fill(null).map(() => ({
                date: '2026-02-23', startTime: '23:00', startKm: 0, endKm: 10, driverName: 'A'
            }));
            const result = detectAnomalies(logs);
            expect(result.find(a => a.type === 'night')).toBeTruthy();
        });

        it('1일 200km 이상 주행이 있으면 경고를 생성한다', () => {
            const logs = [
                { date: '2026-02-23', startKm: 0, endKm: 250, driverName: 'A' },
            ];
            const result = detectAnomalies(logs);
            expect(result.find(a => a.type === 'overdrive')).toBeTruthy();
        });

        it('정상 운행이면 빈 배열을 반환한다', () => {
            const logs = Array(10).fill(null).map(() => ({
                date: '2026-02-23', startTime: '10:00', startKm: 0, endKm: 10, driverName: 'A'
            }));
            const result = detectAnomalies(logs);
            expect(result.length).toBe(0);
        });
    });

    describe('상수 확인', () => {
        it('MONTH_LABELS는 12개월을 포함한다', () => {
            expect(MONTH_LABELS).toHaveLength(12);
            expect(MONTH_LABELS[0]).toBe('1월');
            expect(MONTH_LABELS[11]).toBe('12월');
        });

        it('DAY_NAMES는 7요일을 포함한다', () => {
            expect(DAY_NAMES).toHaveLength(7);
            expect(DAY_NAMES[0]).toBe('일');
            expect(DAY_NAMES[6]).toBe('토');
        });
    });
});
