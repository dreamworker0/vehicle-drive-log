import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getOrganizationMembers } from '../lib/firestore';
import { getMonthlyStats, type MonthlyStat } from '../lib/firestore/statistics';
import type { Vehicle } from '../types/vehicle';
import type { User } from '../types/user';
import { getRecentMonthKeys } from './utils/aggregationUtils';
import {
    calcMonthlyTrend, calcDriveOriginTrend, calcDriveOriginBy, calcDriverComparison,
    calcVehicleUtilization, calcHeatmap, calcFuelEfficiency, calcMaintenanceCostAnalysis,
    calcAnomalies, calcCostTrend, calcHipassUsedTotal, calcAggregatedAt,
    calcRecommendations, calcMonthOverMonth,
} from './utils/analyticsCalc';
import { fetchPublicHolidays } from '../lib/holidayApi';

export default function useAnalytics() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    const [stats, setStats] = useState<MonthlyStat[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [rangeMonths, setRangeMonths] = useState(6);
    /** 가동률 분모에서 뺄 공휴일(YYYY-MM-DD) — 못 받아 오면 비운 채 진행한다(부가 정보) */
    const [holidays, setHolidays] = useState<ReadonlySet<string>>(new Set());

    const monthKeys = useMemo(() => getRecentMonthKeys(rangeMonths), [rangeMonths]);

    // ── 데이터 페칭 (비용 최적화 적용됨) ─────────────────────────────────
    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchAll = async () => {
            setLoading(true);
            try {
                const [s, v, m] = await Promise.all([
                    getMonthlyStats(orgId, monthKeys),
                    getVehicles(orgId),
                    getOrganizationMembers(orgId),
                ]);
                setStats(s);
                setVehicles(v as Vehicle[]);
                setMembers((m as User[]).filter(u => u.role !== 'superAdmin'));
            } catch (err) {
                console.error('분석 데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, [orgId, monthKeys]);

    // ── 파생 계산 — 계산은 analyticsCalc의 순수 함수에 있다(테스트도 그쪽) ─────────────
    const monthlyTrend = useMemo(() => calcMonthlyTrend(stats, monthKeys), [stats, monthKeys]);
    const driveOriginTrend = useMemo(() => calcDriveOriginTrend(stats, monthKeys), [stats, monthKeys]);
    const driveOriginBy = useMemo(() => calcDriveOriginBy(stats), [stats]);
    const driverComparison = useMemo(() => calcDriverComparison(stats, monthKeys), [stats, monthKeys]);

    // 가동률 기간(최근 3개월)에 걸친 해의 공휴일
    const utilYears = useMemo(
        () => [...new Set(monthKeys.slice(-3).map(k => Number(k.slice(0, 4))))].join(','),
        [monthKeys],
    );
    useEffect(() => {
        let cancelled = false;
        Promise.all(utilYears.split(',').map(y => fetchPublicHolidays(Number(y)).catch(() => ({}))))
            .then(maps => {
                if (cancelled) return;
                setHolidays(new Set(maps.flatMap(mp => Object.keys(mp || {}))));
            });
        return () => { cancelled = true; };
    }, [utilYears]);

    const vehicleUtilization = useMemo(
        () => calcVehicleUtilization(stats, vehicles, monthKeys, holidays),
        [stats, vehicles, monthKeys, holidays],
    );
    const heatmapData = useMemo(() => calcHeatmap(stats), [stats]);
    const fuelEfficiency = useMemo(() => calcFuelEfficiency(stats), [stats]);
    const maintenanceCostAnalysis = useMemo(() => calcMaintenanceCostAnalysis(stats, vehicles), [stats, vehicles]);
    const anomalies = useMemo(() => calcAnomalies(stats), [stats]);
    const costTrend = useMemo(() => calcCostTrend(stats, monthKeys), [stats, monthKeys]);

    const totalFuelCost = useMemo(() => costTrend.reduce((s, c) => s + c.fuelCost, 0), [costTrend]);
    const totalHipassCost = useMemo(() => costTrend.reduce((s, c) => s + c.hipassCost, 0), [costTrend]);
    const totalMaintenanceCost = useMemo(() => costTrend.reduce((s, c) => s + c.maintenanceCost, 0), [costTrend]);
    const totalOperatingCost = totalFuelCost + totalHipassCost + totalMaintenanceCost;
    const totalHipassUsed = useMemo(() => calcHipassUsedTotal(stats, monthKeys), [stats, monthKeys]);

    /** 전월 대비 — 다 끝난 지난달과 그 전달 */
    const monthOverMonth = useMemo(() => calcMonthOverMonth(monthlyTrend.map((m, i) => ({
        month: m.month, count: m.count, distance: m.distance, cost: costTrend[i]?.totalCost || 0,
    }))), [monthlyTrend, costTrend]);

    const recommendations = useMemo(() => calcRecommendations({
        fuelEfficiency, driverComparison, maintenanceCostAnalysis,
        anomalies, vehicleUtilization, monthKeys, rangeMonths,
    }), [fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys, rangeMonths]);

    const totalLogs = useMemo(() => stats.reduce((s, st) => s + (st.totalLogs || 0), 0), [stats]);
    const aggregatedAt = useMemo(() => calcAggregatedAt(stats), [stats]);

    return {
        loading,
        rangeMonths, setRangeMonths,
        monthKeys,
        // 트렌드
        monthlyTrend,
        driveOriginTrend,
        driveOriginByDriver: driveOriginBy.byDriver,
        driveOriginByVehicle: driveOriginBy.byVehicle,
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
        totalHipassUsed,
        totalMaintenanceCost,
        totalOperatingCost,
        monthOverMonth,
        // 원시 통계
        totalLogs,
        aggregatedAt,
        totalVehicles: vehicles.length,
        totalMembers: members.length,
    };
}
