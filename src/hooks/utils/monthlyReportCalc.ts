/**
 * 월간보고서 순수 통계 계산 함수
 * useMonthlyReport 훅에서 추출 — 테스트와 재사용이 용이한 순수 함수들
 */
import { toLocalDateStr } from '../../lib/dateUtils';
import type { DriveLog } from '../../types/driveLog';
import type { FuelLog } from '../../types/fuelLog';
import type { HipassCharge } from '../../types/hipassCharge';

import { extractDateStr, calcChangeRate, filterLogsByDateRange, logDistance } from './aggregationUtils';

// ── 메인 통계 ──

/**
 * 비교 구간의 변화율. 비교 구간이 비어 있으면 null — "+100%"는 증가가 아니라 비교할 것이 없는 것이다.
 */
function changeOrNull(cur: number, prev: number): number | null {
    return prev === 0 ? null : calcChangeRate(cur, prev);
}

/**
 * 운행일지 핵심 통계 계산.
 *
 * 연료비는 여기서 세지 않는다 — 운행일지의 fuelAmount/energyCost는 새 일지에 저장되지 않는
 * 옛 필드라 표에는 '-'가, 위쪽 카드(주유 기록 기준)에는 금액이 나와 서로 달랐다. 주유비는
 * 주유 기록(calcFuelStats) 하나로 계산한다.
 */
export function calcDriveStats(
    filteredLogs: DriveLog[],
    prevPeriodLogs: DriveLog[],
    startDate: string,
    endDate: string,
) {
    const totalRuns = filteredLogs.length;
    const totalDistance = filteredLogs.reduce((s, l) => s + logDistance(l), 0);
    const incompleteCount = filteredLogs.filter(l => l.isIncomplete).length;

    const avgDistance = totalRuns > 0 ? Math.round(totalDistance / totalRuns) : 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const daySpan = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const avgDailyRuns = totalRuns > 0 ? (totalRuns / daySpan).toFixed(1) : '0';

    // 비교 구간 대비
    const prevRuns = prevPeriodLogs.length;
    const prevDistance = prevPeriodLogs.reduce((s, l) => s + logDistance(l), 0);
    const runsChange = changeOrNull(totalRuns, prevRuns);
    const distanceChange = changeOrNull(totalDistance, prevDistance);

    // 직원별
    const byDriver: Record<string, { count: number; distance: number }> = {};
    filteredLogs.forEach(l => {
        const key = l.driverName || '(이름 없음)';
        if (!byDriver[key]) byDriver[key] = { count: 0, distance: 0 };
        byDriver[key].count++;
        byDriver[key].distance += logDistance(l);
    });

    // 차량별 — vehicleId로 묶는다(주유 기록과 짝지으려면 이름이 아니라 ID가 필요하다)
    const byVehicle: Record<string, { name: string; count: number; distance: number }> = {};
    filteredLogs.forEach(l => {
        const name = l.vehicleDisplayName || l.vehicleName || '(미지정)';
        const key = l.vehicleId || name;
        if (!byVehicle[key]) byVehicle[key] = { name, count: 0, distance: 0 };
        byVehicle[key].count++;
        byVehicle[key].distance += logDistance(l);
    });

    // 목적별
    const byPurpose: Record<string, number> = {};
    filteredLogs.forEach(l => {
        const p = l.purpose || '(미지정)';
        if (!byPurpose[p]) byPurpose[p] = 0;
        byPurpose[p]++;
    });

    // 일별 운행 추이 — 운행일지에는 date 필드가 없다(timestamp만 저장한다). 예전에는 l.date로만
    // 묶어 새 일지가 전부 빠졌고, 그래서 이 차트는 늘 숨겨져 있었다.
    const byDate: Record<string, { count: number; distance: number }> = {};
    filteredLogs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        if (!byDate[d]) byDate[d] = { count: 0, distance: 0 };
        byDate[d].count++;
        byDate[d].distance += logDistance(l);
    });

    // 요일별 분석
    const byDayOfWeek = Array(7).fill(null).map(() => ({ count: 0, distance: 0 }));
    filteredLogs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const dayIdx = new Date(d).getDay();
        byDayOfWeek[dayIdx].count++;
        byDayOfWeek[dayIdx].distance += logDistance(l);
    });

    // 시간대별 분석
    const byHour = Array(24).fill(0);
    filteredLogs.forEach(l => {
        const t = l.startTime || '';
        if (!t) return;
        const hour = parseInt(t.split(':')[0], 10);
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
            byHour[hour]++;
        }
    });

    return {
        totalRuns, totalDistance, incompleteCount,
        avgDistance, avgDailyRuns,
        runsChange, distanceChange,
        byDriver, byVehicle, byPurpose, byDate,
        byDayOfWeek, byHour,
    };
}

/** 'YYYY-MM-DD'를 months개월 옮긴다. 옮긴 달에 그 날짜가 없으면 말일로 붙인다(3/31 → 2/28). */
function addMonths(dateStr: string, months: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
    return toLocalDateStr(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}

/**
 * 비교 구간.
 *
 * 1일부터 보는 기간이면 **같은 날짜만큼 앞선 달들**과 비교한다 — '이번 달(10/1~10/15)'은
 * 9/1~9/15, '지난 달(9/1~9/30)'은 8/1~8/31, '최근 3개월(8/1~10/15)'은 5/1~7/15.
 * 예전에는 늘 "바로 앞의 같은 길이 구간"이라 10/1의 '이번 달'이 9/30 하루와 비교됐고
 * '지난 달'은 8/1이 빠졌다. 사람들은 이 숫자를 '전월 대비'로 읽는다.
 * 1일이 아닌 날부터 고른 기간은 바로 앞의 같은 길이 구간과 비교한다.
 */
export function calcComparePeriod(startDate: string, endDate: string): { start: string; end: string } {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    if (sd === 1) {
        const months = (ey - sy) * 12 + (em - sm) + 1;
        // 말일에서 끝나는 기간이면 비교 구간도 그 달의 말일까지(9/30 → 8/31)
        const endIsMonthEnd = ed === new Date(ey, em, 0).getDate();
        const end = endIsMonthEnd
            ? toLocalDateStr(new Date(ey, em - months, 0))
            : addMonths(endDate, -months);
        return { start: addMonths(startDate, -months), end };
    }
    const s = new Date(startDate);
    const e = new Date(endDate);
    const daysDiff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(s);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - daysDiff);
    return { start: toLocalDateStr(prevStart), end: toLocalDateStr(prevEnd) };
}

/** 비교 구간 로그 필터링 */
export function filterPrevPeriodLogs(logs: DriveLog[], startDate: string, endDate: string): DriveLog[] {
    const { start, end } = calcComparePeriod(startDate, endDate);
    return filterLogsByDateRange(logs, start, end);
}

/** 주유 통계 */
export function calcFuelStats(fuelLogs: FuelLog[], startDate: string, endDate: string) {
    const filtered = filterLogsByDateRange(fuelLogs, startDate, endDate);
    const totalCost = filtered.reduce((s, l) => s + (l.fuelCost || 0), 0);

    // 주유량은 단위가 다르다 — 휘발유·경유·LPG는 L, 전기는 kWh, 수소는 kg. 한데 더해 'L'을 붙이면 안 된다.
    const amountByUnit: Record<'L' | 'kWh' | 'kg', number> = { L: 0, kWh: 0, kg: 0 };
    filtered.forEach(l => {
        const unit = l.fuelType === 'electric' ? 'kWh' : l.fuelType === 'hydrogen' ? 'kg' : 'L';
        amountByUnit[unit] += l.fuelAmount || 0;
    });

    // 차량별 비용 — 운행일지 차량 표와 vehicleId로 짝짓는다
    const costByVehicleId: Record<string, number> = {};
    filtered.forEach(l => {
        if (l.vehicleId) costByVehicleId[l.vehicleId] = (costByVehicleId[l.vehicleId] || 0) + (l.fuelCost || 0);
    });

    const byVehicle: Record<string, { cost: number; amount: number; count: number }> = {};
    filtered.forEach(l => {
        const name = l.vehicleName || '(미지정)';
        if (!byVehicle[name]) byVehicle[name] = { cost: 0, amount: 0, count: 0 };
        byVehicle[name].cost += l.fuelCost || 0;
        byVehicle[name].amount += l.fuelAmount || 0;
        byVehicle[name].count++;
    });

    const vehicleData = Object.entries(byVehicle)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([name, data]) => ({ name, ...data }));

    return { totalCost, amountByUnit, count: filtered.length, vehicleData, costByVehicleId };
}

/** 하이패스 통계 */
export function calcHipassStats(hipassCharges: HipassCharge[], startDate: string, endDate: string) {
    const filtered = filterLogsByDateRange(hipassCharges, startDate, endDate);
    const totalAmount = filtered.reduce((s, l) => s + (l.chargeAmount || 0), 0);

    const byVehicle: Record<string, { amount: number; count: number }> = {};
    filtered.forEach(l => {
        const name = l.vehicleName || l.cardNumber || '(미지정)';
        if (!byVehicle[name]) byVehicle[name] = { amount: 0, count: 0 };
        byVehicle[name].amount += l.chargeAmount || 0;
        byVehicle[name].count++;
    });

    const vehicleData = Object.entries(byVehicle)
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([name, data]) => ({ name, ...data }));

    return { totalAmount, count: filtered.length, vehicleData };
}

/** 일별 비용 추이 계산 */
export function calcCostTrend(fuelLogs: FuelLog[], hipassCharges: HipassCharge[], startDate: string, endDate: string) {
    const byDate: Record<string, { fuel: number; hipass: number }> = {};

    filterLogsByDateRange(fuelLogs, startDate, endDate).forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        if (!byDate[d]) byDate[d] = { fuel: 0, hipass: 0 };
        byDate[d].fuel += l.fuelCost || 0;
    });

    filterLogsByDateRange(hipassCharges, startDate, endDate).forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        if (!byDate[d]) byDate[d] = { fuel: 0, hipass: 0 };
        byDate[d].hipass += l.chargeAmount || 0;
    });

    return Object.entries(byDate)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, data]) => ({
            date: date.slice(5),
            fuel: data.fuel,
            hipass: data.hipass,
            total: data.fuel + data.hipass,
        }));
}

/** 직원별 데이터 변환 */
export function formatDriverData(byDriver: Record<string, { count: number; distance: number }>) {
    return Object.entries(byDriver)
        .sort((a, b) => b[1].distance - a[1].distance)
        .map(([name, data]) => ({
            name,
            distance: data.distance,
            count: data.count,
            avgDistance: data.count > 0 ? Math.round(data.distance / data.count) : 0,
        }));
}

/** 차량별 데이터 변환 — 주유비는 주유 기록(costByVehicleId)에서 vehicleId로 가져온다 */
export function formatVehicleData(
    byVehicle: Record<string, { name: string; count: number; distance: number }>,
    costByVehicleId: Record<string, number>,
) {
    return Object.entries(byVehicle)
        .sort((a, b) => b[1].distance - a[1].distance)
        .map(([key, data]) => ({
            name: data.name,
            distance: data.distance,
            count: data.count,
            fuel: costByVehicleId[key] || 0,
        }));
}

/** 목적별 데이터 변환 */
export function formatPurposeData(byPurpose: Record<string, number>) {
    return Object.entries(byPurpose)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([name, value]) => ({ name, value: value as number }));
}

/** 일별 추이 데이터 변환 */
export function formatDailyTrendData(byDate: Record<string, { count: number; distance: number }>) {
    return Object.entries(byDate || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, data]) => ({
            date: date.slice(5),
            count: data.count,
            distance: data.distance,
        }));
}

/**
 * 시간대 차트에 그릴 범위 — 기본 06~22시, 그 밖에 운행이 있으면 거기까지 넓힌다.
 * 예전에는 06~22시로 잘라 심야·새벽 운행이 이 화면에서 보이지 않았다.
 */
export function hourlyRange(hourly: { count: number }[]): [number, number] {
    let lo = 6;
    let hi = Math.min(22, hourly.length - 1);
    hourly.forEach((h, i) => {
        if (h.count > 0) {
            if (i < lo) lo = i;
            if (i > hi) hi = i;
        }
    });
    return [lo, hi];
}
