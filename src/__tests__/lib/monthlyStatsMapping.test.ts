/**
 * monthlyStatsMapping.test.ts
 *
 * 프로듀서(runDailyAggregation) 원시 스키마 → 소비자(useAnalytics)용 평탄 MonthlyStat 변환 검증.
 * 이 매핑이 어긋나면 admin 분석 대시보드가 전부 0/빈 값으로 나오므로(과거 회귀), 필드별 1:1 매핑을 고정한다.
 */
import { describe, it, expect, vi } from 'vitest';
// 전역 setup.ts가 이 모듈을 모킹(getMonthlyStats만 노출)하므로, 변환 순수함수 검증을 위해 실제 구현으로 복원한다.
vi.unmock('@/lib/firestore/statistics');
const { mapMonthlyDoc } = await vi.importActual<typeof import('../../lib/firestore/statistics')>('../../lib/firestore/statistics');

describe('mapMonthlyDoc — 프로듀서 스키마 → 평탄 MonthlyStat', () => {
    // 프로듀서(functions/handlers/scheduled/dailyAggregation.ts)가 실제로 저장하는 형태
    const rawDoc = {
        yearMonth: '2026-06',
        monthlyTotal: { count: 12, distance: 340 },
        costStats: { fuelCost: 50000, hipassCost: 8000, maintenanceCost: 120000 },
        driverStats: {
            'uid-1': { name: '김운전', count: 7, distance: 200 },
            'uid-2': { name: '이기사', count: 5, distance: 140 },
        },
        vehicleStats: {
            'veh-1': { name: '스타렉스', usedDays: 9, count: 7 },
            'veh-2': { name: '카니발', usedDays: 4, count: 5 },
        },
        heatmap: {
            '1': { '9': 3, '14': 2 }, // 월요일 09시 3건, 14시 2건
            '5': { '18': 1 },          // 금요일 18시 1건
        },
    };

    it('중첩 monthlyTotal/costStats를 평탄 필드로 변환한다', () => {
        const m = mapMonthlyDoc('2026-06', rawDoc);
        expect(m.monthKey).toBe('2026-06');
        expect(m.totalLogs).toBe(12);
        expect(m.totalDistance).toBe(340);
        expect(m.fuelCost).toBe(50000);
        expect(m.hipassCost).toBe(8000);
        expect(m.maintenanceCost).toBe(120000);
    });

    it('heatmap 중첩객체를 {dayIdx, hour, count} 배열로 펼친다', () => {
        const m = mapMonthlyDoc('2026-06', rawDoc);
        expect(m.heatmapData).toHaveLength(3);
        expect(m.heatmapData).toContainEqual({ dayIdx: 1, hour: 9, count: 3 });
        expect(m.heatmapData).toContainEqual({ dayIdx: 1, hour: 14, count: 2 });
        expect(m.heatmapData).toContainEqual({ dayIdx: 5, hour: 18, count: 1 });
    });

    it('driverStats의 name을 보존하고 count/distance를 유지한다', () => {
        const m = mapMonthlyDoc('2026-06', rawDoc);
        expect(m.driverStats['uid-1']).toEqual({ name: '김운전', count: 7, distance: 200 });
        expect(m.driverStats['uid-2'].name).toBe('이기사');
    });

    it('vehicleStats는 vehId 키를 유지하고 usedDays를 보존하며 미산출 비용 필드는 0으로 채운다', () => {
        const m = mapMonthlyDoc('2026-06', rawDoc);
        expect(m.vehicleStats['veh-1'].name).toBe('스타렉스');
        expect(m.vehicleStats['veh-1'].usedDays).toBe(9);
        // 프로듀서가 계산하지 않는 필드 — 소비자 계산이 안전히 통과하도록 0
        expect(m.vehicleStats['veh-1'].totalDist).toBe(0);
        expect(m.vehicleStats['veh-1'].totalCost).toBe(0);
        expect(m.vehicleStats['veh-1'].maintenanceCost).toBe(0);
        expect(m.vehicleStats['veh-1'].maintenanceCount).toBe(0);
    });

    it('필드가 누락된 문서도 안전하게 0/빈 값으로 변환한다', () => {
        const m = mapMonthlyDoc('2026-05', {});
        expect(m.totalLogs).toBe(0);
        expect(m.totalDistance).toBe(0);
        expect(m.fuelCost).toBe(0);
        expect(m.hipassCost).toBe(0);
        expect(m.maintenanceCost).toBe(0);
        expect(m.heatmapData).toEqual([]);
        expect(m.driverStats).toEqual({});
        expect(m.vehicleStats).toEqual({});
        expect(m.anomalies).toEqual({ weekend: 0, night: 0, overDrive: 0 });
    });
});
