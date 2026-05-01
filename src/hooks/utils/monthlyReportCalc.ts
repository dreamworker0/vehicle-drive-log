/**
 * 월간보고서 순수 통계 계산 함수
 * useMonthlyReport 훅에서 추출 — 테스트와 재사용이 용이한 순수 함수들
 */
import { toLocalDateStr } from '../../lib/dateUtils';
import type { DriveLog } from '../../types/driveLog';
import type { FuelLog } from '../../types/fuelLog';
import type { HipassCharge } from '../../types/hipassCharge';

import { extractDateStr, calcChangeRate, filterLogsByDateRange, type BaseLog } from './aggregationUtils';

// ── 메인 통계 ──

/** 운행일지 핵심 통계 계산 */
export function calcDriveStats(
    filteredLogs: DriveLog[],
    prevPeriodLogs: DriveLog[],
    startDate: string,
    endDate: string,
) {
    const totalRuns = filteredLogs.length;
    const totalDistance = filteredLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
    const totalFuel = filteredLogs.reduce((s, l) => s + (l.fuelAmount || l.energyCost || 0), 0);
    const incompleteCount = filteredLogs.filter(l => l.isIncomplete).length;

    const avgDistance = totalRuns > 0 ? Math.round(totalDistance / totalRuns) : 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const daySpan = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const avgDailyRuns = totalRuns > 0 ? (totalRuns / daySpan).toFixed(1) : '0';

    // 전월 대비
    const prevRuns = prevPeriodLogs.length;
    const prevDistance = prevPeriodLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
    const prevFuel = prevPeriodLogs.reduce((s, l) => s + (l.fuelAmount || l.energyCost || 0), 0);

    const runsChange = calcChangeRate(totalRuns, prevRuns);
    const distanceChange = calcChangeRate(totalDistance, prevDistance);
    const fuelChange = calcChangeRate(totalFuel, prevFuel);

    // 직원별
    const byDriver: Record<string, { count: number; distance: number }> = {};
    filteredLogs.forEach(l => {
        const key = l.driverName || '(이름 없음)';
        if (!byDriver[key]) byDriver[key] = { count: 0, distance: 0 };
        byDriver[key].count++;
        byDriver[key].distance += (l.endKm - l.startKm) || 0;
    });

    // 차량별
    const byVehicle: Record<string, { count: number; distance: number }> = {};
    const byVehicleFuel: Record<string, number> = {};
    filteredLogs.forEach(l => {
        const name = l.vehicleDisplayName || l.vehicleName || '(미지정)';
        if (!byVehicle[name]) byVehicle[name] = { count: 0, distance: 0 };
        byVehicle[name].count++;
        byVehicle[name].distance += (l.endKm - l.startKm) || 0;
        const fuel = l.fuelAmount || l.energyCost || 0;
        if (!byVehicleFuel[name]) byVehicleFuel[name] = 0;
        byVehicleFuel[name] += fuel;
    });

    // 목적별
    const byPurpose: Record<string, number> = {};
    filteredLogs.forEach(l => {
        const p = l.purpose || '(미지정)';
        if (!byPurpose[p]) byPurpose[p] = 0;
        byPurpose[p]++;
    });

    // 일별 운행 추이
    const byDate: Record<string, { count: number; distance: number }> = {};
    filteredLogs.forEach(l => {
        const d = l.date || '';
        if (!d) return;
        if (!byDate[d]) byDate[d] = { count: 0, distance: 0 };
        byDate[d].count++;
        byDate[d].distance += (l.endKm - l.startKm) || 0;
    });

    // 요일별 분석
    const byDayOfWeek = Array(7).fill(null).map(() => ({ count: 0, distance: 0 }));
    filteredLogs.forEach(l => {
        const d = extractDateStr(l);
        if (!d) return;
        const dayIdx = new Date(d).getDay();
        byDayOfWeek[dayIdx].count++;
        byDayOfWeek[dayIdx].distance += (l.endKm - l.startKm) || 0;
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
        totalRuns, totalDistance, totalFuel, incompleteCount,
        avgDistance, avgDailyRuns,
        runsChange, distanceChange, fuelChange,
        byDriver, byVehicle, byVehicleFuel, byPurpose, byDate,
        byDayOfWeek, byHour,
    };
}

/** 전월 기간 로그 필터링 */
export function filterPrevPeriodLogs(logs: DriveLog[], startDate: string, endDate: string): DriveLog[] {
    const s = new Date(startDate);
    const e = new Date(endDate);
    const daysDiff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(s);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - daysDiff);
    const ps = toLocalDateStr(prevStart);
    const pe = toLocalDateStr(prevEnd);

    return filterLogsByDateRange(logs, ps, pe);
}

/** 주유 통계 */
export function calcFuelStats(fuelLogs: FuelLog[], startDate: string, endDate: string) {
    const filtered = filterLogsByDateRange(fuelLogs, startDate, endDate);
    const totalCost = filtered.reduce((s, l) => s + (l.fuelCost || 0), 0);
    const totalAmount = filtered.reduce((s, l) => s + (l.fuelAmount || 0), 0);

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

    return { totalCost, totalAmount, count: filtered.length, vehicleData };
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

/** 차량별 데이터 변환 */
export function formatVehicleData(
    byVehicle: Record<string, { count: number; distance: number }>,
    byVehicleFuel: Record<string, number>,
) {
    return Object.entries(byVehicle)
        .sort((a, b) => b[1].distance - a[1].distance)
        .map(([name, data]) => ({
            name,
            distance: data.distance,
            count: data.count,
            fuel: byVehicleFuel[name] || 0,
        }));
}

/** 목적별 데이터 변환 */
export function formatPurposeData(byPurpose: Record<string, number>) {
    return Object.entries(byPurpose)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([name, value]) => ({ name, value: value as number }));
}

/** 차량별 연료 데이터 변환 */
export function formatVehicleFuelData(byVehicleFuel: Record<string, number>) {
    return Object.entries(byVehicleFuel || {})
        .filter(([, v]) => (v as number) > 0)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([name, amount]) => ({ name, amount: amount as number }));
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
