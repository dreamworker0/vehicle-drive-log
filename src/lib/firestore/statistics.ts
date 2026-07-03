import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface DriverStat {
    name?: string;
    count: number;
    distance: number;
}

export interface VehicleStat {
    name?: string;
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
 * 프로듀서(runDailyAggregation) 산출 문서의 원시 스키마.
 * 야간 배치가 orgStats/{orgId}/monthly/{YYYY-MM}에 이 형태로 저장한다.
 * 소비자(useAnalytics)가 기대하는 평탄 MonthlyStat과 필드 구조가 다르므로 아래 mapMonthlyDoc으로 변환한다.
 */
interface RawMonthlyDoc {
    monthlyTotal?: { count?: number; distance?: number };
    costStats?: { fuelCost?: number; hipassCost?: number; maintenanceCost?: number };
    driverStats?: Record<string, { name?: string; count?: number; distance?: number }>;
    vehicleStats?: Record<string, {
        name?: string; usedDays?: number; count?: number;
        distance?: number; fuelCost?: number;
        maintenanceCost?: number; maintenanceCount?: number; lastMaintenanceDate?: string;
    }>;
    heatmap?: Record<string, Record<string, number>>;
    anomalies?: { weekend?: number; night?: number; overDrive?: number };
}

/**
 * 프로듀서 원시 문서 → 소비자용 평탄 MonthlyStat 변환.
 * - monthlyTotal/costStats(중첩) → totalLogs/totalDistance/fuelCost 등(평탄)
 * - heatmap(요일→시간 중첩객체) → heatmapData(배열)
 * - driverStats/vehicleStats는 프로듀서 키(uid/vehId)를 유지하되 name을 보존(소비자가 name/id로 매칭)
 * 프로듀서가 아직 값을 채우지 않은 문서(구버전)는 누락 필드를 0/빈 값으로 안전히 채운다.
 */
export function mapMonthlyDoc(monthKey: string, raw: RawMonthlyDoc): MonthlyStat {
    const heatmapData: HeatmapStat[] = [];
    const heatmap = raw.heatmap || {};
    for (const dayKey of Object.keys(heatmap)) {
        const hours = heatmap[dayKey] || {};
        for (const hourKey of Object.keys(hours)) {
            heatmapData.push({ dayIdx: Number(dayKey), hour: Number(hourKey), count: hours[hourKey] || 0 });
        }
    }

    const driverStats: Record<string, DriverStat> = {};
    for (const [uid, d] of Object.entries(raw.driverStats || {})) {
        driverStats[uid] = { name: d.name, count: d.count || 0, distance: d.distance || 0 };
    }

    const vehicleStats: Record<string, VehicleStat> = {};
    for (const [vehId, v] of Object.entries(raw.vehicleStats || {})) {
        // 프로듀서 필드(distance/fuelCost) → 소비자 필드(totalDist/totalCost)로 정렬
        vehicleStats[vehId] = {
            name: v.name,
            usedDays: v.usedDays || 0,
            totalDist: v.distance || 0,
            totalCost: v.fuelCost || 0,
            maintenanceCost: v.maintenanceCost || 0,
            maintenanceCount: v.maintenanceCount || 0,
            lastMaintenanceDate: v.lastMaintenanceDate,
        };
    }

    return {
        monthKey,
        totalLogs: raw.monthlyTotal?.count || 0,
        totalDistance: raw.monthlyTotal?.distance || 0,
        fuelCost: raw.costStats?.fuelCost || 0,
        hipassCost: raw.costStats?.hipassCost || 0,
        maintenanceCost: raw.costStats?.maintenanceCost || 0,
        driverStats,
        vehicleStats,
        heatmapData,
        anomalies: {
            weekend: raw.anomalies?.weekend || 0,
            night: raw.anomalies?.night || 0,
            overDrive: raw.anomalies?.overDrive || 0,
        },
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
            // 프로듀서 원시 스키마를 소비자용 평탄 구조로 변환 (필드명 불일치 흡수)
            return mapMonthlyDoc(snapshot.id, snapshot.data() as RawMonthlyDoc);
        }
        return null;
    });

    const results = await Promise.all(promises);
    return results.filter((res): res is MonthlyStat => res !== null);
};
