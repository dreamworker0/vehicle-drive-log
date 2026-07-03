import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getOrganizationMembers } from '../lib/firestore';
import { getMonthlyStats, MonthlyStat } from '../lib/firestore/statistics';
import type { Vehicle } from '../types/vehicle';
import type { User } from '../types/user';
import { getRecentMonthKeys } from './utils/aggregationUtils';
import {
    DAY_NAMES, MONTH_LABELS, getWorkdaysInMonth, calcRecommendations,
} from './utils/analyticsCalc';
import type { CostTrendItem, DriverComparisonItem, RecommendationItem } from './utils/analyticsCalc';

export default function useAnalytics() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    const [stats, setStats] = useState<MonthlyStat[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [rangeMonths, setRangeMonths] = useState(6);

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

    // ── 파생 계산 (월별 집계 문서를 Recharts 상태 구조로 병합) ────────────────────────
    
    const monthlyTrend = useMemo(() => {
        return monthKeys.map(mk => {
            const stat = stats.find(s => s.monthKey === mk);
            const label = MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
            return {
                month: mk,
                label,
                count: stat?.totalLogs || 0,
                distance: stat?.totalDistance || 0,
                fuelCost: stat?.fuelCost || 0,
            };
        });
    }, [stats, monthKeys]);

    const driverComparison = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        const map: Record<string, { totalCount: number, totalDistance: number, months: Record<string, {count: number, distance: number}> }> = {};
        
        recentKeys.forEach(mk => {
            const stat = stats.find(s => s.monthKey === mk);
            if (stat?.driverStats) {
                // 집계 문서의 driverStats는 uid 키 + name 필드 구조 → 표시는 name 기준으로 그룹화
                Object.values(stat.driverStats).forEach((dStat) => {
                    const driverName = dStat.name || '알 수 없음';
                    if (!map[driverName]) map[driverName] = { totalCount: 0, totalDistance: 0, months: {} };
                    if (!map[driverName].months[mk]) map[driverName].months[mk] = { count: 0, distance: 0 };

                    map[driverName].months[mk].count += dStat.count;
                    map[driverName].months[mk].distance += dStat.distance;
                    map[driverName].totalCount += dStat.count;
                    map[driverName].totalDistance += dStat.distance;
                });
            }
        });

        return Object.entries(map).map(([name, d]) => ({
            name,
            totalCount: d.totalCount,
            totalDistance: d.totalDistance,
            ...recentKeys.reduce((acc, mk) => {
                const label = MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
                acc[`${label}_count`] = d.months[mk]?.count || 0;
                acc[`${label}_distance`] = d.months[mk]?.distance || 0;
                return acc;
            }, {} as Record<string, number>),
            monthLabels: recentKeys.map(mk => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1]),
        })).sort((a, b) => b.totalCount - a.totalCount);
    }, [stats, monthKeys]);

    const vehicleUtilization = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        const totalWorkdays = recentKeys.reduce((s, k) => s + getWorkdaysInMonth(k), 0);
        const map: Record<string, number> = {};
        
        recentKeys.forEach(mk => {
            const stat = stats.find(s => s.monthKey === mk);
            if (stat?.vehicleStats) {
                // 집계 문서의 vehicleStats는 vehId 키 구조 → 차량 매칭은 v.id 기준 (이름 불일치 회피)
                Object.entries(stat.vehicleStats).forEach(([vehId, vStat]) => {
                    map[vehId] = (map[vehId] || 0) + (vStat.usedDays || 0);
                });
            }
        });

        return vehicles.map(v => {
            const name = v.displayName || v.plateNumber || '(미지정)';
            const usedDays = map[v.id] || 0;
            const rate = totalWorkdays > 0 ? Math.round((usedDays / totalWorkdays) * 100) : 0;
            return { name, usedDays, totalWorkdays, rate };
        }).sort((a, b) => b.rate - a.rate);
    }, [stats, vehicles, monthKeys]);

    const heatmapData = useMemo(() => {
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
        stats.forEach(stat => {
            if (stat.heatmapData) {
                stat.heatmapData.forEach(h => {
                    if (h.dayIdx >= 0 && h.dayIdx < 7 && h.hour >= 0 && h.hour < 24) {
                        grid[h.dayIdx][h.hour] += h.count;
                    }
                });
            }
        });
        
        const items: { day: string, dayIdx: number, hour: number, count: number }[] = [];
        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                if (grid[d][h] > 0) items.push({ day: DAY_NAMES[d], dayIdx: d, hour: h, count: grid[d][h] });
            }
        }
        return { grid, items, maxCount: Math.max(1, ...items.map(i => i.count)) };
    }, [stats]);

    const fuelEfficiency = useMemo(() => {
        // vehicleStats는 vehId 키 구조 → vehId로 누적하고 표시명은 vStat.name 사용
        // (프로듀서가 아직 차량별 연비를 산출하지 않아 현재는 빈 결과, 향후 산출 시 조인 일관성 확보)
        const map: Record<string, { name: string, totalDist: number, totalCost: number }> = {};
        stats.forEach(stat => {
            if (stat.vehicleStats) {
                Object.entries(stat.vehicleStats).forEach(([vehId, vStat]) => {
                    if (!map[vehId]) map[vehId] = { name: vStat.name || vehId, totalDist: 0, totalCost: 0 };
                    map[vehId].totalDist += (vStat.totalDist || 0);
                    map[vehId].totalCost += (vStat.totalCost || 0);
                });
            }
        });

        const items = Object.values(map).filter((v) => v.totalDist > 0 && v.totalCost > 0).map((v) => ({
            name: v.name,
            totalDist: v.totalDist,
            totalCost: v.totalCost,
            costPerKm: Math.round((v.totalCost / v.totalDist) * 10) / 10
        })).sort((a, b) => b.costPerKm - a.costPerKm);
        
        const avgCostPerKm = items.length > 0 ? Math.round((items.reduce((s, r) => s + r.costPerKm, 0) / items.length) * 10) / 10 : 0;
        return { items, avgCostPerKm };
    }, [stats]);

    const maintenanceCostAnalysis = useMemo(() => {
        // vehicleStats는 vehId 키 구조 → vehId로 누적하고 차량 매칭은 v.id 기준
        // (프로듀서가 아직 차량별 정비비를 산출하지 않아 현재는 0, 향후 산출 시 조인 일관성 확보)
        const map: Record<string, { totalCost: number, count: number, lastDate: string }> = {};
        stats.forEach(stat => {
            if (stat.vehicleStats) {
                Object.entries(stat.vehicleStats).forEach(([vehId, vStat]) => {
                    if (!map[vehId]) map[vehId] = { totalCost: 0, count: 0, lastDate: '' };
                    map[vehId].totalCost += (vStat.maintenanceCost || 0);
                    map[vehId].count += (vStat.maintenanceCount || 0);
                    if (vStat.lastMaintenanceDate && vStat.lastMaintenanceDate > map[vehId].lastDate) {
                        map[vehId].lastDate = vStat.lastMaintenanceDate;
                    }
                });
            }
        });

        return vehicles.map(v => {
            const name = v.displayName || v.plateNumber || '(미지정)';
            const maint = map[v.id] || { totalCost: 0, count: 0, lastDate: '' };
            const currentKm = v.currentKm || 0;
            return {
                name,
                totalMaintenanceCost: maint.totalCost,
                maintenanceCount: maint.count,
                lastMaintenanceDate: maint.lastDate,
                currentKm,
                costPerKm: currentKm > 0 ? Math.round((maint.totalCost / currentKm) * 100) / 100 : 0
            };
        }).sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost);
    }, [stats, vehicles]);

    const anomalies = useMemo(() => {
        const sums = { weekend: 0, night: 0, overDrive: 0, totalLogs: 0 };
        stats.forEach(s => {
            sums.weekend += (s.anomalies?.weekend || 0);
            sums.night += (s.anomalies?.night || 0);
            sums.overDrive += (s.anomalies?.overDrive || 0);
            sums.totalLogs += (s.totalLogs || 0);
        });
        
        const items: { type: string; icon: string; severity: string; title: string; desc: string }[] = [];
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
    }, [stats]);

    const costTrend = useMemo(() => {
        return monthKeys.map(mk => {
            const stat = stats.find(s => s.monthKey === mk);
            const monthNum = parseInt(mk.split('-')[1], 10);
            return {
                label: MONTH_LABELS[monthNum - 1],
                fuelCost: stat?.fuelCost || 0,
                hipassCost: stat?.hipassCost || 0,
                maintenanceCost: stat?.maintenanceCost || 0,
                totalCost: (stat?.fuelCost || 0) + (stat?.hipassCost || 0) + (stat?.maintenanceCost || 0)
            };
        });
    }, [stats, monthKeys]);

    const totalFuelCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.fuelCost, 0), [costTrend]);
    const totalHipassCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.hipassCost, 0), [costTrend]);
    const totalMaintenanceCost = useMemo(() => costTrend.reduce((s: number, c: CostTrendItem) => s + c.maintenanceCost, 0), [costTrend]);
    const totalOperatingCost = useMemo(() => totalFuelCost + totalHipassCost + totalMaintenanceCost, [totalFuelCost, totalHipassCost, totalMaintenanceCost]);

    const recommendations = useMemo(() => calcRecommendations({
        fuelEfficiency, driverComparison: driverComparison as DriverComparisonItem[], maintenanceCostAnalysis,
        anomalies, vehicleUtilization, monthKeys,
    }), [fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys]);

    const totalLogs = useMemo(() => stats.reduce((s, st) => s + (st.totalLogs || 0), 0), [stats]);

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
        totalLogs,
        totalVehicles: vehicles.length,
        totalMembers: members.length,
    };
}
