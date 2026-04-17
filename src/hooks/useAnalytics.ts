/**
 * useAnalytics — 트렌드 분석 + 비용 최적화 데이터 훅
 * AnalyticsDashboard에서 사용하는 커스텀 훅
 *
 * 리팩토링: 순수 계산 로직 → utils/analyticsCalc
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getDriveLogs, getVehicles, getOrganizationMembers, getMaintenanceRecords, getFuelLogs, getAllHipassCharges } from '../lib/firestore';
import type { DriveLog } from '../types/driveLog';
import type { Vehicle } from '../types/vehicle';
import type { User } from '../types/user';
import type { MaintenanceRecord } from '../types/maintenance';
import type { FuelLog } from '../types/fuelLog';
import type { HipassCharge } from '../types/hipassCharge';
import { getRecentMonthKeys, extractDateStr } from './utils/aggregationUtils';
import {
    calcMonthlyTrend, calcHeatmapData, detectAnomalies,
    calcDriverComparison, calcVehicleUtilization,
    calcFuelEfficiency, calcMaintenanceCostAnalysis,
    calcCostTrend, calcRecommendations,
} from './utils/analyticsCalc';
import type { LogEntry, CostTrendItem } from './utils/analyticsCalc';

export default function useAnalytics() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
    const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
    const [hipassCharges, setHipassCharges] = useState<HipassCharge[]>([]);
    const [loading, setLoading] = useState(true);
    const [rangeMonths, setRangeMonths] = useState(6);

    // ── 데이터 페칭 (IO) ─────────────────────────────────
    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchAll = async () => {
            setLoading(true);
            try {
                const sinceDate = new Date();
                sinceDate.setMonth(sinceDate.getMonth() - rangeMonths - 1);
                sinceDate.setDate(1);

                const [l, v, m, mr, fl, hc] = await Promise.all([
                    getDriveLogs(orgId, { limit: 2000, since: sinceDate }).then(r => r.docs),
                    getVehicles(orgId),
                    getOrganizationMembers(orgId),
                    getMaintenanceRecords(orgId),
                    getFuelLogs(orgId).catch(() => []),
                    getAllHipassCharges(orgId).catch(() => []),
                ]);
                setLogs(l as DriveLog[]);
                setVehicles(v as Vehicle[]);
                setMembers((m as User[]).filter(u => u.role !== 'superAdmin'));
                setMaintenanceRecords(mr as MaintenanceRecord[]);
                setFuelLogs(fl as FuelLog[]);
                setHipassCharges(hc as HipassCharge[]);
            } catch (err) {
                console.error('분석 데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, [orgId, rangeMonths]);

    // ── 파생 계산 (순수 함수 위임) ────────────────────────
    const monthKeys = useMemo(() => getRecentMonthKeys(rangeMonths), [rangeMonths]);

    const filteredLogs = useMemo(() => {
        const startMonth = monthKeys[0];
        return logs.filter(l => {
            const d = extractDateStr(l as unknown as LogEntry);
            if (!d) return false;
            return d >= `${startMonth}-01`;
        }) as unknown as LogEntry[];
    }, [logs, monthKeys]);

    const monthlyTrend = useMemo(() => calcMonthlyTrend(filteredLogs, monthKeys), [filteredLogs, monthKeys]);
    const driverComparison = useMemo(() => calcDriverComparison(filteredLogs, monthKeys), [filteredLogs, monthKeys]);
    const vehicleUtilization = useMemo(() => calcVehicleUtilization(filteredLogs, vehicles, monthKeys), [filteredLogs, vehicles, monthKeys]);
    const heatmapData = useMemo(() => calcHeatmapData(filteredLogs), [filteredLogs]);
    const fuelEfficiency = useMemo(() => calcFuelEfficiency(filteredLogs), [filteredLogs]);
    const maintenanceCostAnalysis = useMemo(() => calcMaintenanceCostAnalysis(vehicles, maintenanceRecords), [vehicles, maintenanceRecords]);
    const anomalies = useMemo(() => detectAnomalies(filteredLogs), [filteredLogs]);
    const costTrend = useMemo(() => calcCostTrend(fuelLogs, hipassCharges, maintenanceRecords, monthKeys), [fuelLogs, hipassCharges, maintenanceRecords, monthKeys]);

    const totalFuelCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.fuelCost, 0), [costTrend]);
    const totalHipassCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.hipassCost, 0), [costTrend]);
    const totalMaintenanceCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.maintenanceCost, 0), [costTrend]);
    const totalOperatingCost = useMemo(() => totalFuelCost + totalHipassCost + totalMaintenanceCost, [totalFuelCost, totalHipassCost, totalMaintenanceCost]);

    const recommendations = useMemo(() => calcRecommendations({
        fuelEfficiency, driverComparison, maintenanceCostAnalysis,
        anomalies, vehicleUtilization, monthKeys,
    }), [fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys]);

    return {
        loading,
        rangeMonths, setRangeMonths,
        monthKeys,
        // 트렌드
        monthlyTrend,
        driverComparison,
        vehicleUtilization,
        heatmapData,
        // 비용 최적화
        fuelEfficiency,
        maintenanceCostAnalysis,
        anomalies,
        recommendations,
        // 주유/하이패스/정비 비용 트렌드
        costTrend,
        totalFuelCost,
        totalHipassCost,
        totalMaintenanceCost,
        totalOperatingCost,
        // 원시 통계
        totalLogs: filteredLogs.length,
        totalVehicles: vehicles.length,
        totalMembers: members.length,
    };
}
