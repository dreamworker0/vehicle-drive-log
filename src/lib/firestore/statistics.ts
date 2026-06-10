import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface DriverStat {
    count: number;
    distance: number;
}

export interface VehicleStat {
    usedDays: number;
    totalDist: number;
    totalCost: number;
    maintenanceCost: number;
    maintenanceCount: number;
    currentKm?: number;
    lastMaintenanceDate?: string;
}

export interface HeatmapStat {
    dayIdx: number;
    hour: number;
    count: number;
}

export interface MonthlyStat {
    monthKey: string;
    totalLogs: number;
    totalDistance: number;
    fuelCost: number;
    hipassCost: number;
    maintenanceCost: number;
    driverStats: Record<string, DriverStat>;
    vehicleStats: Record<string, VehicleStat>;
    heatmapData: HeatmapStat[];
    anomalies: {
        weekend: number;
        night: number;
        overDrive: number;
    };
}

/**
 * 월별 집계 문서(orgStats/{orgId}/monthly/{monthKey})를 조회합니다.
 * @param orgId 조직 ID (보안 규칙 D10 통과를 위해 필수 포함)
 * @param monthKeys 조회할 월 키 배열 (예: ['2026-01', '2026-02'])
 */
export const getMonthlyStats = async (orgId: string, monthKeys: string[]): Promise<MonthlyStat[]> => {
    if (!orgId || monthKeys.length === 0) return [];
    
    // 문서 참조를 통한 개별 조회 (보안 규칙에서 organizationId == orgId 조건 충족 및 명시적 접근)
    const promises = monthKeys.map(async (key) => {
        const docRef = doc(db, 'orgStats', orgId, 'monthly', key);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return {
                monthKey: snapshot.id,
                ...snapshot.data()
            } as MonthlyStat;
        }
        return null;
    });

    const results = await Promise.all(promises);
    return results.filter((res): res is MonthlyStat => res !== null);
};
