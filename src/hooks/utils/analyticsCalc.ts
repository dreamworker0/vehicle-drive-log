/**
 * 분석(Analytics) 계산 유틸리티 — 순수 함수로 단위 테스트 가능
 */

import { extractDateStr, formatMonth, getRecentMonthKeys } from './aggregationUtils';
export { formatMonth, extractDateStr as getLogDate, getRecentMonthKeys };

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export interface LogEntry {
    date?: string;
    timestamp?: Date | { toDate?: () => Date };
    startTime?: string;
    departureTime?: string;
    startKm?: number;
    endKm?: number;
    fuelAmount?: number;
    energyCost?: number;
    driverName?: string;
    vehicleDisplayName?: string;
    vehicleName?: string;
}

interface TrendEntry {
    [key: string]: unknown;
    month: string;
    count: number;
    distance: number;
    fuelCost: number;
    label: string;
}

// aggregationUtils 참조로 대체됨

/**
 * 해당 월의 근무일 수 추정 (주말 제외, 공휴일 미포함)
 */
export function getWorkdaysInMonth(yearMonth: string) {
    const [y, m] = yearMonth.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);
    let count = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

/**
 * 월별 운행 추이를 계산한다.
 */
export function calcMonthlyTrend(logs: LogEntry[], monthKeys: string[]): TrendEntry[] {
    const map: Record<string, { month: string; count: number; distance: number; fuelCost: number }> = {};
    monthKeys.forEach(k => { map[k] = { month: k, count: 0, distance: 0, fuelCost: 0 }; });

    logs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const mk = d.slice(0, 7);
        if (!map[mk]) return;
        map[mk].count++;
        map[mk].distance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
        map[mk].fuelCost += l.fuelAmount || l.energyCost || 0;
    });

    return monthKeys.map(k => ({
        ...map[k],
        label: MONTH_LABELS[parseInt(k.split('-')[1], 10) - 1],
    }));
}

/**
 * 요일 × 시간대 히트맵 데이터를 계산한다.
 */
export function calcHeatmapData(logs: LogEntry[]) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);

    logs.forEach(l => {
        const d = extractDateStr(l);
        const t = l.startTime || l.departureTime || '';
        if (!d || !t) return;
        const dayIdx = new Date(d).getDay();
        const hour = parseInt(t.split(':')[0], 10);
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
            grid[dayIdx][hour]++;
        }
    });

    const result: { day: string; dayIdx: number; hour: number; count: number }[] = [];
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        for (let hour = 0; hour < 24; hour++) {
            if (grid[dayIdx][hour] > 0) {
                result.push({
                    day: DAY_NAMES[dayIdx],
                    dayIdx,
                    hour,
                    count: grid[dayIdx][hour],
                });
            }
        }
    }
    return { grid, items: result, maxCount: Math.max(1, ...result.map(r => r.count)) };
}

/**
 * 비정상 운행을 탐지한다.
 */
export function detectAnomalies(logs: LogEntry[]) {
    const items: { type: string; icon: string; severity: string; title: string; desc: string }[] = [];

    // 주말 운행
    const weekendLogs = logs.filter(l => {
        const d = extractDateStr(l);
        if (!d) return false;
        const dow = new Date(d).getDay();
        return dow === 0 || dow === 6;
    });
    const weekendRate = logs.length > 0
        ? Math.round((weekendLogs.length / logs.length) * 100) : 0;

    if (weekendRate > 15) {
        items.push({
            type: 'weekend',
            icon: '📅',
            severity: weekendRate > 30 ? 'high' : 'medium',
            title: `주말 운행 비율 ${weekendRate}%`,
            desc: `전체 ${logs.length}건 중 ${weekendLogs.length}건이 주말 운행입니다. 예약 정책 검토를 권장합니다.`,
        });
    }

    // 심야 운행 (22시~06시)
    const nightLogs = logs.filter(l => {
        const t = l.startTime || l.departureTime || '';
        if (!t) return false;
        const h = parseInt(t.split(':')[0], 10);
        return h >= 22 || h < 6;
    });
    if (nightLogs.length > 3) {
        items.push({
            type: 'night',
            icon: '🌙',
            severity: nightLogs.length > 10 ? 'high' : 'medium',
            title: `심야 운행 ${nightLogs.length}건 감지`,
            desc: `22시~06시 사이 운행이 ${nightLogs.length}건 발생했습니다.`,
        });
    }

    // 1일 과다 주행 (200km 이상)
    const dailyDist: Record<string, { driver: string; date: string; distance: number }> = {};
    logs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const key = `${l.driverName || '?'}_${d}`;
        if (!dailyDist[key]) dailyDist[key] = { driver: l.driverName || '(이름 없음)', date: d, distance: 0 };
        dailyDist[key].distance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
    });
    const overDrive = Object.values(dailyDist).filter(d => d.distance > 200);
    if (overDrive.length > 0) {
        items.push({
            type: 'overdrive',
            icon: '⚡',
            severity: overDrive.length > 5 ? 'high' : 'low',
            title: `1일 200km 이상 주행 ${overDrive.length}건`,
            desc: `장거리 운행이 빈번합니다. 운행 분담 또는 경로 최적화를 검토하세요.`,
        });
    }

    return items;
}

// ─── useAnalytics에서 추출된 순수 계산 함수들 ────────────

interface VehicleInfo {
    displayName?: string;
    plateNumber?: string;
    name?: string;
    currentKm?: number;
    id: string;
}

interface MaintenanceInfo {
    vehicleName?: string;
    cost?: number;
    date: string;
}

interface FuelLogInfo {
    date?: string;
    fuelCost?: number;
}

interface HipassChargeInfo {
    date?: string;
    chargeAmount?: number;
}

export interface DriverComparisonItem {
    name: string;
    totalCount: number;
    totalDistance: number;
    monthLabels: string[];
    [key: string]: unknown;
}

export interface VehicleUtilizationItem {
    name: string;
    usedDays: number;
    totalWorkdays: number;
    rate: number;
}

export interface FuelEfficiencyItem {
    name: string;
    totalDist: number;
    totalCost: number;
    costPerKm: number;
}

export interface MaintenanceCostItem {
    name: string;
    totalMaintenanceCost: number;
    maintenanceCount: number;
    lastMaintenanceDate: string;
    currentKm: number;
    costPerKm: number;
}

export interface CostTrendItem {
    label: string;
    fuelCost: number;
    hipassCost: number;
    maintenanceCost: number;
    totalCost: number;
}

export interface RecommendationItem {
    type: string;
    icon: string;
    priority: string;
    title: string;
    desc: string;
}

/** 직원별 운행 비교 (최근 3개월) */
export function calcDriverComparison(logs: LogEntry[], monthKeys: string[]): DriverComparisonItem[] {
    const recentKeys = monthKeys.slice(-3);
    const map: Record<string, { name: string; totalCount: number; totalDistance: number; months: Record<string, { count: number; distance: number }> }> = {};

    logs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const mk = d.slice(0, 7);
        if (!recentKeys.includes(mk)) return;
        const driver = l.driverName || '(이름 없음)';
        if (!map[driver]) map[driver] = { name: driver, totalCount: 0, totalDistance: 0, months: {} };
        if (!map[driver].months[mk]) map[driver].months[mk] = { count: 0, distance: 0 };
        map[driver].months[mk].count++;
        map[driver].months[mk].distance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
        map[driver].totalCount++;
        map[driver].totalDistance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
    });

    return Object.values(map)
        .sort((a, b) => b.totalCount - a.totalCount)
        .map(d => ({
            name: d.name,
            totalCount: d.totalCount,
            totalDistance: d.totalDistance,
            ...recentKeys.reduce((acc: Record<string, number>, mk: string) => {
                const label = MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
                acc[`${label}_count`] = d.months[mk]?.count || 0;
                acc[`${label}_distance`] = d.months[mk]?.distance || 0;
                return acc;
            }, {} as Record<string, number>),
            monthLabels: recentKeys.map(mk => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1]),
        }));
}

/** 차량별 가동률 */
export function calcVehicleUtilization(logs: LogEntry[], vehicles: VehicleInfo[], monthKeys: string[]): VehicleUtilizationItem[] {
    const recentKeys = monthKeys.slice(-3);
    const totalWorkdays = recentKeys.reduce((s: number, k: string) => s + getWorkdaysInMonth(k), 0);

    const daysByVehicle: Record<string, Set<string>> = {};
    logs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const mk = d.slice(0, 7);
        if (!recentKeys.includes(mk)) return;
        const vn = l.vehicleDisplayName || l.vehicleName || '(미지정)';
        if (!daysByVehicle[vn]) daysByVehicle[vn] = new Set();
        daysByVehicle[vn].add(d);
    });

    return vehicles.map(v => {
        const name = v.displayName || v.plateNumber || '(미지정)';
        const usedDays = daysByVehicle[name]?.size || 0;
        const rate = totalWorkdays > 0 ? Math.round((usedDays / totalWorkdays) * 100) : 0;
        return { name, usedDays, totalWorkdays, rate };
    }).sort((a, b) => b.rate - a.rate);
}

/** 차량별 km당 연료비 */
export function calcFuelEfficiency(logs: LogEntry[]): { items: FuelEfficiencyItem[]; avgCostPerKm: number } {
    const map: Record<string, { totalDist: number; totalCost: number }> = {};
    logs.forEach(l => {
        const name = l.vehicleDisplayName || l.vehicleName || '(미지정)';
        const dist = ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
        const cost = l.fuelAmount || l.energyCost || 0;
        if (dist <= 0) return;
        if (!map[name]) map[name] = { totalDist: 0, totalCost: 0 };
        map[name].totalDist += dist;
        map[name].totalCost += cost;
    });

    const result = Object.entries(map)
        .filter(([, v]) => v.totalDist > 0 && v.totalCost > 0)
        .map(([name, v]) => ({
            name,
            totalDist: v.totalDist,
            totalCost: v.totalCost,
            costPerKm: Math.round((v.totalCost / v.totalDist) * 10) / 10,
        }))
        .sort((a, b) => b.costPerKm - a.costPerKm);

    const avgCostPerKm = result.length > 0
        ? Math.round((result.reduce((s, r) => s + r.costPerKm, 0) / result.length) * 10) / 10
        : 0;

    return { items: result, avgCostPerKm };
}

/** 차량별 정비비 분석 */
export function calcMaintenanceCostAnalysis(vehicles: VehicleInfo[], maintenanceRecords: MaintenanceInfo[]): MaintenanceCostItem[] {
    const maintMap: Record<string, { totalCost: number; count: number; lastDate: string }> = {};
    maintenanceRecords.forEach(r => {
        const name = r.vehicleName || '(미지정)';
        if (!maintMap[name]) maintMap[name] = { totalCost: 0, count: 0, lastDate: '' };
        maintMap[name].totalCost += r.cost || 0;
        maintMap[name].count++;
        if (r.date > maintMap[name].lastDate) maintMap[name].lastDate = r.date;
    });

    return vehicles.map(v => {
        const name = v.displayName || v.plateNumber || '(미지정)';
        const maint = maintMap[name] || { totalCost: 0, count: 0, lastDate: '' };
        const currentKm = v.currentKm || 0;
        return {
            name,
            totalMaintenanceCost: maint.totalCost,
            maintenanceCount: maint.count,
            lastMaintenanceDate: maint.lastDate,
            currentKm,
            costPerKm: currentKm > 0 ? Math.round((maint.totalCost / currentKm) * 100) / 100 : 0,
        };
    }).sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost);
}

/** 월별 주유비 + 하이패스 충전비 + 정비비 트렌드 */
export function calcCostTrend(
    fuelLogs: FuelLogInfo[],
    hipassCharges: HipassChargeInfo[],
    maintenanceRecords: MaintenanceInfo[],
    monthKeys: string[],
): CostTrendItem[] {
    const fuelByMonth: Record<string, number> = {};
    fuelLogs.forEach(l => {
        if (!l.date) return;
        const mk = l.date.slice(0, 7);
        if (!monthKeys.includes(mk)) return;
        if (!fuelByMonth[mk]) fuelByMonth[mk] = 0;
        fuelByMonth[mk] += l.fuelCost || 0;
    });

    const hipassByMonth: Record<string, number> = {};
    hipassCharges.forEach(l => {
        if (!l.date) return;
        const mk = l.date.slice(0, 7);
        if (!monthKeys.includes(mk)) return;
        if (!hipassByMonth[mk]) hipassByMonth[mk] = 0;
        hipassByMonth[mk] += l.chargeAmount || 0;
    });

    const maintByMonth: Record<string, number> = {};
    maintenanceRecords.forEach(r => {
        if (!r.date) return;
        const mk = r.date.slice(0, 7);
        if (!monthKeys.includes(mk)) return;
        if (!maintByMonth[mk]) maintByMonth[mk] = 0;
        maintByMonth[mk] += r.cost || 0;
    });

    return monthKeys.map(mk => {
        const monthNum = parseInt(mk.split('-')[1], 10);
        const fuel = fuelByMonth[mk] || 0;
        const hipass = hipassByMonth[mk] || 0;
        const maint = maintByMonth[mk] || 0;
        return {
            label: MONTH_LABELS[monthNum - 1],
            fuelCost: fuel,
            hipassCost: hipass,
            maintenanceCost: maint,
            totalCost: fuel + hipass + maint,
        };
    });
}

/** 최적화 추천 카드 생성 */
export function calcRecommendations(params: {
    fuelEfficiency: { items: FuelEfficiencyItem[]; avgCostPerKm: number };
    driverComparison: DriverComparisonItem[];
    maintenanceCostAnalysis: MaintenanceCostItem[];
    anomalies: ReturnType<typeof detectAnomalies>;
    vehicleUtilization: VehicleUtilizationItem[];
    monthKeys: string[];
}): RecommendationItem[] {
    const { fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys } = params;
    const items: RecommendationItem[] = [];

    // 1) 연료 비효율 차량
    const { items: fuelItems, avgCostPerKm } = fuelEfficiency;
    fuelItems.forEach(f => {
        if (avgCostPerKm > 0 && f.costPerKm > avgCostPerKm * 1.3) {
            const overPercent = Math.round(((f.costPerKm - avgCostPerKm) / avgCostPerKm) * 100);
            items.push({
                type: 'fuel',
                icon: '⛽',
                priority: 'high',
                title: `${f.name} 연료 효율 저하`,
                desc: `km당 연료비가 평균 대비 ${overPercent}% 높습니다 (${f.costPerKm}원/km vs 평균 ${avgCostPerKm}원/km). 차량 점검을 권장합니다.`,
            });
        }
    });

    // 2) 직원 운행량 급증
    const recentKeys = monthKeys.slice(-3);
    if (recentKeys.length >= 2) {
        const lastMonth = recentKeys[recentKeys.length - 1];
        const prevMonth = recentKeys[recentKeys.length - 2];
        driverComparison.forEach((d: Record<string, unknown>) => {
            const lastLabel = MONTH_LABELS[parseInt(lastMonth.split('-')[1], 10) - 1];
            const prevLabel = MONTH_LABELS[parseInt(prevMonth.split('-')[1], 10) - 1];
            const lastCount = (d[`${lastLabel}_count`] as number) || 0;
            const prevCount = (d[`${prevLabel}_count`] as number) || 0;
            if (prevCount >= 5 && lastCount > prevCount * 1.5) {
                const increase = Math.round(((lastCount - prevCount) / prevCount) * 100);
                items.push({
                    type: 'driver_increase',
                    icon: '👤',
                    priority: 'medium',
                    title: `${d.name} 운행량 급증`,
                    desc: `최근 한 달 운행이 전월 대비 ${increase}% 증가했습니다 (${prevCount}건 → ${lastCount}건). 업무 분담을 검토하세요.`,
                });
            }
        });
    }

    // 3) 정비 시기 알림
    maintenanceCostAnalysis.forEach(v => {
        if (!v.lastMaintenanceDate || !v.currentKm) return;
        const daysSinceMaint = Math.floor((new Date().getTime() - new Date(v.lastMaintenanceDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceMaint > 90) {
            items.push({
                type: 'maintenance',
                icon: '🔧',
                priority: daysSinceMaint > 180 ? 'high' : 'medium',
                title: `${v.name} 정비 점검 권장`,
                desc: `마지막 정비로부터 ${daysSinceMaint}일 경과. 정기 점검 시기입니다.`,
            });
        }
    });

    // 4) 주말 운행 정책
    anomalies.filter(a => a.type === 'weekend').forEach(a => {
        items.push({
            type: 'policy',
            icon: '📋',
            priority: 'low',
            title: '주말 운행 정책 검토',
            desc: a.desc,
        });
    });

    // 5) 가동률 낮은 차량
    vehicleUtilization.forEach(v => {
        if (v.rate < 10 && v.totalWorkdays > 20) {
            items.push({
                type: 'underuse',
                icon: '🅿️',
                priority: 'low',
                title: `${v.name} 가동률 매우 낮음`,
                desc: `최근 3개월 가동률 ${v.rate}%. 차량 운용 효율성을 검토하세요.`,
            });
        }
    });

    return items.sort((a, b) => {
        const p: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (p[a.priority] ?? 3) - (p[b.priority] ?? 3);
    });
}
