/**
 * 분석 계산 테스트용 픽스처 — 야간 집계 문서(MonthlyStat)와 차량을 필요한 필드만 채워 만든다.
 */
import type { MonthlyStat, VehicleStat } from '../../lib/firestore/statistics';
import type { AnalyticsVehicle } from '../../hooks/utils/analyticsCalc';

export const stat = (monthKey: string, over: Partial<MonthlyStat> = {}): MonthlyStat => ({
    monthKey,
    totalLogs: 0,
    totalDistance: 0,
    fuelCost: 0,
    hipassCost: 0,
    hipassUsed: null,
    maintenanceCost: 0,
    driverStats: {},
    vehicleStats: {},
    heatmapData: [],
    anomalies: { weekend: 0, night: 0, overDrive: 0 },
    updatedAt: null,
    originCounts: { reservation: 0, quick: 0, manual: 0, linked: 0 },
    ...over,
});

export const vstat = (over: Partial<VehicleStat> = {}): VehicleStat => ({
    usedDays: 0, totalDist: 0, totalCost: 0, maintenanceCost: 0, maintenanceCount: 0, ...over,
});

export const vehicle = (id: string, over: Partial<AnalyticsVehicle> = {}): AnalyticsVehicle => ({
    id, plateNumber: `${id}-번호`, currentKm: 0, ...over,
});
