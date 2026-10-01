/**
 * 분석(Analytics) 계산 — 야간 집계 문서(MonthlyStat)를 화면 데이터로 바꾸는 순수 함수.
 *
 * 예전에는 화면이 쓰는 계산이 `useAnalytics` 훅 안에 있고, 이 파일에는 **원본 일지를 받는**
 * 옛 함수들(아무도 부르지 않는다)이 테스트와 함께 남아 있었다. 테스트가 통과해도 화면 숫자가
 * 맞다는 보장이 없었다. 지금은 훅이 이 함수들을 부르기만 하고, 테스트도 이 함수들을 본다.
 */
import type { MonthlyStat, DriveOriginCounts } from '../../lib/firestore/statistics';
import type { Vehicle } from '../../types/vehicle';

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

/** 'YYYY-MM' → '9월' */
const monthLabel = (mk: string) => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];

/** monthKeys 순서대로 그 달 문서를 찾는다 — 문서가 없는 달은 undefined */
const statOf = (stats: readonly MonthlyStat[], mk: string) => stats.find(s => s.monthKey === mk);

/** 분석 화면이 차량 문서에서 읽는 필드 */
export type AnalyticsVehicle = Pick<Vehicle, 'id' | 'displayName' | 'plateNumber' | 'currentKm' | 'insurance' | 'retired'>;

const vehicleName = (v: AnalyticsVehicle) => v.displayName || v.plateNumber || '(미지정)';

/**
 * 가동률 분모 — 그 달의 평일 중 공휴일이 아닌 날. `until`이 그 달 안이면 그날까지만 센다.
 *
 * 예전 분모(getWorkdaysInMonth)는 진행 중인 이번 달도 한 달 전체를 넣고 공휴일도 빼지 않아,
 * 10/1에 보면 10월 약 22일이 분모에 들어가 가동률이 1/3쯤 낮게 나왔고 '가동률 낮음' 추천이
 * 잘못 떴다.
 */
export function countWorkdays(yearMonth: string, holidays: ReadonlySet<string>, until: Date = new Date()) {
    const [y, m] = yearMonth.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const untilDay = new Date(until.getFullYear(), until.getMonth(), until.getDate());
    const lastDay = untilDay < monthEnd ? untilDay : monthEnd;
    let count = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!holidays.has(key)) count++;
    }
    return count;
}

// ─── 트렌드 ─────────────────────────────────────────────

// interface가 아니라 type — 차트 props의 인덱스 시그니처({ [key: string]: unknown })에 그대로 들어가야 한다
export type MonthlyTrendItem = {
    month: string;
    label: string;
    count: number;
    distance: number;
    fuelCost: number;
};

/** 월별 운행 추이 — 문서가 없는 달은 0 */
export function calcMonthlyTrend(stats: readonly MonthlyStat[], monthKeys: readonly string[]): MonthlyTrendItem[] {
    return monthKeys.map(mk => {
        const stat = statOf(stats, mk);
        return {
            month: mk,
            label: monthLabel(mk),
            count: stat?.totalLogs || 0,
            distance: stat?.totalDistance || 0,
            fuelCost: stat?.fuelCost || 0,
        };
    });
}

export interface DriveOriginTrendItem extends DriveOriginCounts {
    month: string;
    label: string;
}

/** 월별 운행 방식 — 사전 예약 · 바로 운행 · 예약 없이 기록 · 예약 연결(구분 전) */
export function calcDriveOriginTrend(stats: readonly MonthlyStat[], monthKeys: readonly string[]): DriveOriginTrendItem[] {
    return monthKeys.map(mk => {
        const o = statOf(stats, mk)?.originCounts;
        return {
            month: mk,
            label: monthLabel(mk),
            reservation: o?.reservation || 0,
            quick: o?.quick || 0,
            manual: o?.manual || 0,
            linked: o?.linked || 0,
        };
    });
}

export interface DriveOriginByRow extends DriveOriginCounts {
    name: string;
    total: number;
}

/**
 * 직원별·차량별 운행 방식 — 분석 기간 전체 합계, 운행이 많은 순 상위 10.
 * 이 필드가 생기기 전의 월간 문서는 origin이 없어 건너뛴다(그 달은 0으로 센다).
 */
export function calcDriveOriginBy(stats: readonly MonthlyStat[]): { byDriver: DriveOriginByRow[]; byVehicle: DriveOriginByRow[] } {
    const collect = (pick: (s: MonthlyStat) => Record<string, { name?: string; origin?: DriveOriginCounts }>) => {
        const map: Record<string, DriveOriginByRow> = {};
        for (const s of stats) {
            for (const [id, v] of Object.entries(pick(s) || {})) {
                if (!v.origin) continue;
                const row = map[id] ?? (map[id] = { name: v.name || '알 수 없음', reservation: 0, quick: 0, manual: 0, linked: 0, total: 0 });
                if (v.name) row.name = v.name;
                row.reservation += v.origin.reservation;
                row.quick += v.origin.quick;
                row.manual += v.origin.manual;
                row.linked += v.origin.linked;
                row.total += v.origin.reservation + v.origin.quick + v.origin.manual + v.origin.linked;
            }
        }
        return Object.values(map).filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
    };
    return { byDriver: collect(s => s.driverStats), byVehicle: collect(s => s.vehicleStats) };
}

/** 직원별 운행 비교 — 최근 3개월 */
export function calcDriverComparison(stats: readonly MonthlyStat[], monthKeys: readonly string[]): DriverComparisonItem[] {
    const recentKeys = monthKeys.slice(-3);
    const map: Record<string, { name: string; totalCount: number; totalDistance: number; months: Record<string, { count: number; distance: number }> }> = {};

    recentKeys.forEach(mk => {
        const stat = statOf(stats, mk);
        if (!stat?.driverStats) return;
        // 계정(uid)으로 묶는다 — 이름으로 묶으면 동명이인이 합쳐지고, 이름을 바꾼 사람이 둘로 나뉜다.
        // 표시 이름은 가장 최근 달의 것(recentKeys는 과거→현재 순이라 덮어쓰면 최신이 남는다).
        Object.entries(stat.driverStats).forEach(([uid, dStat]) => {
            if (!map[uid]) map[uid] = { name: '', totalCount: 0, totalDistance: 0, months: {} };
            if (dStat.name) map[uid].name = dStat.name;
            if (!map[uid].months[mk]) map[uid].months[mk] = { count: 0, distance: 0 };

            map[uid].months[mk].count += dStat.count;
            map[uid].months[mk].distance += dStat.distance;
            map[uid].totalCount += dStat.count;
            map[uid].totalDistance += dStat.distance;
        });
    });

    // 동명이인은 차트 축에서 한 줄로 합쳐지므로 번호를 붙여 가른다
    const seen: Record<string, number> = {};
    return Object.values(map).map((d) => {
        const base = d.name || '알 수 없음';
        seen[base] = (seen[base] || 0) + 1;
        return { ...d, name: seen[base] > 1 ? `${base} (${seen[base]})` : base };
    }).map((d) => ({
        name: d.name,
        totalCount: d.totalCount,
        totalDistance: d.totalDistance,
        ...recentKeys.reduce((acc, mk) => {
            const label = monthLabel(mk);
            acc[`${label}_count`] = d.months[mk]?.count || 0;
            acc[`${label}_distance`] = d.months[mk]?.distance || 0;
            return acc;
        }, {} as Record<string, number>),
        monthLabels: recentKeys.map(monthLabel),
    })).sort((a, b) => b.totalCount - a.totalCount);
}

/** 차량 가동률 — 최근 3개월, 공휴일을 빼고 진행 중인 이번 달은 `until`까지 */
export function calcVehicleUtilization(
    stats: readonly MonthlyStat[],
    vehicles: readonly AnalyticsVehicle[],
    monthKeys: readonly string[],
    holidays: ReadonlySet<string>,
    until: Date = new Date(),
): VehicleUtilizationItem[] {
    const recentKeys = monthKeys.slice(-3);
    const totalWorkdays = recentKeys.reduce((s, k) => s + countWorkdays(k, holidays, until), 0);
    const map: Record<string, number> = {};

    recentKeys.forEach(mk => {
        const stat = statOf(stats, mk);
        if (!stat?.vehicleStats) return;
        // 집계 문서의 vehicleStats는 vehId 키 구조 → 차량 매칭은 v.id 기준 (이름 불일치 회피)
        Object.entries(stat.vehicleStats).forEach(([vehId, vStat]) => {
            map[vehId] = (map[vehId] || 0) + (vStat.usedDays || 0);
        });
    });

    return vehicles.map(v => {
        const usedDays = map[v.id] || 0;
        // 주말·공휴일 운행도 가동일에 들어가 분모(평일)를 넘을 수 있다 — 100%에서 멈춘다
        const rate = totalWorkdays > 0 ? Math.min(100, Math.round((usedDays / totalWorkdays) * 100)) : 0;
        return { name: vehicleName(v), usedDays, totalWorkdays, rate };
    }).sort((a, b) => b.rate - a.rate);
}

export interface HeatmapResult {
    grid: number[][];
    items: { day: string; dayIdx: number; hour: number; count: number }[];
    maxCount: number;
}

/** 요일 × 시간대 히트맵 — 기간 전체 합 */
export function calcHeatmap(stats: readonly MonthlyStat[]): HeatmapResult {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    stats.forEach(stat => {
        stat.heatmapData?.forEach(h => {
            if (h.dayIdx >= 0 && h.dayIdx < 7 && h.hour >= 0 && h.hour < 24) {
                grid[h.dayIdx][h.hour] += h.count;
            }
        });
    });

    const items: HeatmapResult['items'] = [];
    for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
            if (grid[d][h] > 0) items.push({ day: DAY_NAMES[d], dayIdx: d, hour: h, count: grid[d][h] });
        }
    }
    return { grid, items, maxCount: Math.max(1, ...items.map(i => i.count)) };
}

// ─── 비용 ───────────────────────────────────────────────

/** 차량별 km당 연료비 — 거리와 연료비가 모두 있는 차량만, 비싼 순 */
export function calcFuelEfficiency(stats: readonly MonthlyStat[]): { items: FuelEfficiencyItem[]; avgCostPerKm: number } {
    // vehicleStats는 vehId 키 구조 → vehId로 누적하고 표시명은 vStat.name 사용
    const map: Record<string, { name: string; totalDist: number; totalCost: number }> = {};
    stats.forEach(stat => {
        Object.entries(stat.vehicleStats || {}).forEach(([vehId, vStat]) => {
            if (!map[vehId]) map[vehId] = { name: vStat.name || vehId, totalDist: 0, totalCost: 0 };
            map[vehId].totalDist += (vStat.totalDist || 0);
            map[vehId].totalCost += (vStat.totalCost || 0);
        });
    });

    const items = Object.values(map).filter((v) => v.totalDist > 0 && v.totalCost > 0).map((v) => ({
        name: v.name,
        totalDist: v.totalDist,
        totalCost: v.totalCost,
        costPerKm: Math.round((v.totalCost / v.totalDist) * 10) / 10,
    })).sort((a, b) => b.costPerKm - a.costPerKm);

    const avgCostPerKm = items.length > 0 ? Math.round((items.reduce((s, r) => s + r.costPerKm, 0) / items.length) * 10) / 10 : 0;
    return { items, avgCostPerKm };
}

/** 차량별 정비비·횟수·마지막 정비일 + 보험 만료일(추천용) — 정비비가 큰 순 */
export function calcMaintenanceCostAnalysis(stats: readonly MonthlyStat[], vehicles: readonly AnalyticsVehicle[]): MaintenanceCostItem[] {
    // vehicleStats는 vehId 키 구조 → vehId로 누적하고 차량 매칭은 v.id 기준
    const map: Record<string, { totalCost: number; count: number; lastDate: string }> = {};
    stats.forEach(stat => {
        Object.entries(stat.vehicleStats || {}).forEach(([vehId, vStat]) => {
            if (!map[vehId]) map[vehId] = { totalCost: 0, count: 0, lastDate: '' };
            map[vehId].totalCost += (vStat.maintenanceCost || 0);
            map[vehId].count += (vStat.maintenanceCount || 0);
            if (vStat.lastMaintenanceDate && vStat.lastMaintenanceDate > map[vehId].lastDate) {
                map[vehId].lastDate = vStat.lastMaintenanceDate;
            }
        });
    });

    return vehicles.map(v => {
        const maint = map[v.id] || { totalCost: 0, count: 0, lastDate: '' };
        const currentKm = v.currentKm || 0;
        return {
            name: vehicleName(v),
            totalMaintenanceCost: maint.totalCost,
            maintenanceCount: maint.count,
            lastMaintenanceDate: maint.lastDate,
            currentKm,
            costPerKm: currentKm > 0 ? Math.round((maint.totalCost / currentKm) * 100) / 100 : 0,
            insuranceExpiryDate: v.insurance?.expiryDate,
            retired: !!v.retired?.isRetired,
        };
    }).sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost);
}

export interface AnomalyItem {
    type: 'weekend' | 'night' | 'overdrive';
    icon: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    desc: string;
}

/**
 * 이상 운행 — 기간 합계로 판정한다. 주말 비율 15% 초과(30% 초과는 높음), 심야 3건 초과(10건 초과는
 * 높음), 하루 200km 초과 1건 이상(5건 초과는 높음). 세는 기준(출발 시각 등)은 야간 집계에 있다.
 */
export function calcAnomalies(stats: readonly MonthlyStat[]): AnomalyItem[] {
    const sums = { weekend: 0, night: 0, overDrive: 0, totalLogs: 0 };
    stats.forEach(s => {
        sums.weekend += (s.anomalies?.weekend || 0);
        sums.night += (s.anomalies?.night || 0);
        sums.overDrive += (s.anomalies?.overDrive || 0);
        sums.totalLogs += (s.totalLogs || 0);
    });

    const items: AnomalyItem[] = [];
    const weekendRate = sums.totalLogs > 0 ? Math.round((sums.weekend / sums.totalLogs) * 100) : 0;

    if (weekendRate > 15) {
        items.push({ type: 'weekend', icon: '📅', severity: weekendRate > 30 ? 'high' : 'medium', title: `주말 운행 비율 ${weekendRate}%`, desc: `전체 ${sums.totalLogs}건 중 ${sums.weekend}건이 주말 운행입니다. 예약 정책 검토를 권장합니다.` });
    }
    if (sums.night > 3) {
        items.push({ type: 'night', icon: '🌙', severity: sums.night > 10 ? 'high' : 'medium', title: `심야 운행 ${sums.night}건 감지`, desc: `22시~06시 사이 운행이 ${sums.night}건 발생했습니다.` });
    }
    if (sums.overDrive > 0) {
        items.push({ type: 'overdrive', icon: '⚡', severity: sums.overDrive > 5 ? 'high' : 'low', title: `1일 200km 이상 주행 ${sums.overDrive}건`, desc: `장거리 운행이 빈번합니다. 운행 분담 또는 경로 최적화를 검토하세요.` });
    }
    return items;
}

/** 월별 비용 추이 — 주유 · 하이패스(충전액) · 정비 */
export function calcCostTrend(stats: readonly MonthlyStat[], monthKeys: readonly string[]): CostTrendItem[] {
    return monthKeys.map(mk => {
        const stat = statOf(stats, mk);
        const fuelCost = stat?.fuelCost || 0;
        const hipassCost = stat?.hipassCost || 0;
        const maintenanceCost = stat?.maintenanceCost || 0;
        return { label: monthLabel(mk), fuelCost, hipassCost, maintenanceCost, totalCost: fuelCost + hipassCost + maintenanceCost };
    });
}

/** 하이패스 실제 사용액 합 — 사용액을 담은 달이 하나도 없으면(집계 도입 전) null */
export function calcHipassUsedTotal(stats: readonly MonthlyStat[], monthKeys: readonly string[]): number | null {
    const months = stats.filter(s => monthKeys.includes(s.monthKey) && s.hipassUsed !== null);
    return months.length ? months.reduce((sum, s) => sum + (s.hipassUsed || 0), 0) : null;
}

/** 가장 최근 집계 시각 — 화면에 "언제 기준 숫자인지" 적는다 */
export function calcAggregatedAt(stats: readonly MonthlyStat[]): Date | null {
    const times = stats.map(s => s.updatedAt?.getTime() || 0).filter(t => t > 0);
    return times.length ? new Date(Math.max(...times)) : null;
}

// ─── 타입 · 추천 · 전월 대비 ───────────────────────────────

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
    /** 보험 만료일 (YYYY-MM-DD) — 차량 관리에서 입력한 값 */
    insuranceExpiryDate?: string;
    /** 운행을 중지한(퇴역) 차량 — 정비·보험 추천에서 뺀다 */
    retired?: boolean;
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

/** 로컬(KST) 'YYYY-MM-DD' */
function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** from → to 날짜 차(일). to가 없거나 깨졌으면 null */
function daysUntil(from: string, to: string | undefined): number | null {
    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export interface MonthCompareMetric {
    key: 'count' | 'distance' | 'cost';
    label: string;
    unit: string;
    cur: number;
    prev: number;
    /** 증감률(%) — 비교할 전달 값이 0이면 null */
    pct: number | null;
}

export interface MonthCompare {
    /** 비교하는 달 ('9월') — 진행 중인 이번 달이 아니라 **지난달**이다 */
    label: string;
    prevLabel: string;
    metrics: MonthCompareMetric[];
}

/**
 * 전월 대비 증감 — **지난달**과 그 전달을 비교한다.
 *
 * 이번 달은 진행 중이라(그리고 야간 집계라 오늘 운행도 빠져 있다) 꽉 찬 전달과 견주면 늘 줄어든 것처럼
 * 보인다. 그래서 다 끝난 달끼리 비교한다. rows는 과거→현재 순이고 마지막이 이번 달이다.
 */
export function calcMonthOverMonth(rows: ReadonlyArray<{ month: string; count: number; distance: number; cost: number }>): MonthCompare | null {
    if (rows.length < 3) return null;
    const cur = rows[rows.length - 2];
    const prev = rows[rows.length - 3];
    const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const label = (mk: string) => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
    const metrics: MonthCompareMetric[] = [
        { key: 'count', label: '운행', unit: '건', cur: cur.count, prev: prev.count, pct: pct(cur.count, prev.count) },
        { key: 'distance', label: '주행거리', unit: 'km', cur: cur.distance, prev: prev.distance, pct: pct(cur.distance, prev.distance) },
        { key: 'cost', label: '운영비', unit: '원', cur: cur.cost, prev: prev.cost, pct: pct(cur.cost, prev.cost) },
    ];
    if (metrics.every(m => m.cur === 0 && m.prev === 0)) return null;
    return { label: label(cur.month), prevLabel: label(prev.month), metrics };
}

/** 최적화 추천 카드 생성 */
export function calcRecommendations(params: {
    fuelEfficiency: { items: FuelEfficiencyItem[]; avgCostPerKm: number };
    driverComparison: readonly DriverComparisonItem[];
    maintenanceCostAnalysis: readonly MaintenanceCostItem[];
    anomalies: readonly AnomalyItem[];
    vehicleUtilization: readonly VehicleUtilizationItem[];
    monthKeys: readonly string[];
    /** 분석 기간(개월) — '기간 내 정비 기록 없음'은 6개월 이상일 때만 본다 */
    rangeMonths?: number;
}): RecommendationItem[] {
    const { fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys, rangeMonths = 0 } = params;
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
    const today = localDateStr(new Date());
    // 정비를 기록하는 기관인가 — 기록을 아예 쓰지 않는 기관에 모든 차량 경고를 띄우지 않는다
    const orgRecordsMaintenance = maintenanceCostAnalysis.some(v => v.maintenanceCount > 0);
    maintenanceCostAnalysis.forEach(v => {
        if (v.retired) return;

        // 3-1) 보험 만료 — 만료됐거나 30일 안
        const left = daysUntil(today, v.insuranceExpiryDate);
        if (left !== null && left <= 30) {
            items.push({
                type: 'insurance',
                icon: '🛡️',
                priority: left <= 7 ? 'high' : 'medium',
                title: left < 0 ? `${v.name} 보험 만료됨` : `${v.name} 보험 만료 ${left === 0 ? '오늘' : `D-${left}`}`,
                desc: left < 0
                    ? `보험이 ${v.insuranceExpiryDate}에 만료됐어요. 갱신했다면 [차량 관리]에서 만료일을 고쳐 주세요.`
                    : `보험이 ${v.insuranceExpiryDate}에 만료돼요. 갱신 일정을 확인하세요.`,
            });
        }

        // 3-2) 분석 기간 안에 정비 기록이 한 건도 없는 차량 — 마지막 정비일을 모르므로 '경과일'로는 잡히지 않는다
        if (v.maintenanceCount === 0 && v.currentKm > 0 && orgRecordsMaintenance && rangeMonths >= 6) {
            items.push({
                type: 'maintenance',
                icon: '🔧',
                priority: 'medium',
                title: `${v.name} 정비 기록 없음`,
                desc: `최근 ${rangeMonths}개월 동안 정비 기록이 없어요. 다른 차량은 정비를 기록하고 있으니 점검 시기를 확인해 보세요.`,
            });
            return;
        }

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
