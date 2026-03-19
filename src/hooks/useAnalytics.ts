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
import {
    MONTH_LABELS, getLogDate, getRecentMonthKeys, getWorkdaysInMonth,
    calcMonthlyTrend, calcHeatmapData, detectAnomalies,
} from './utils/analyticsCalc';
import type { LogEntry } from './utils/analyticsCalc';

// 유틸리티 함수들은 utils/analyticsCalc에서 import

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
    const [rangeMonths, setRangeMonths] = useState(6); // 기본 6개월

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchAll = async () => {
            setLoading(true);
            try {
                // rangeMonths + 1개월 여유를 두고 서버 쿼리에 기간 필터 적용
                const sinceDate = new Date();
                sinceDate.setMonth(sinceDate.getMonth() - rangeMonths - 1);
                sinceDate.setDate(1); // 해당 월의 1일부터

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

    // 월별 키 목록
    const monthKeys = useMemo(() => getRecentMonthKeys(rangeMonths), [rangeMonths]);

    // 기간 범위 내 로그 필터
    const filteredLogs = useMemo(() => {
        const startMonth = monthKeys[0];
        const filtered = logs.filter(l => {
            const d = getLogDate(l as unknown as LogEntry);
            if (!d) return false;
            return d >= `${startMonth}-01`;
        });
        return filtered as unknown as LogEntry[];
    }, [logs, monthKeys]);

    // 트렌드 분석 (analyticsCalc 유틸리티 사용)
    const monthlyTrend = useMemo(() => calcMonthlyTrend(filteredLogs, monthKeys), [filteredLogs, monthKeys]);

    /** 직원별 운행 비교 (최근 3개월) */
    const driverComparison = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        const map: Record<string, { name: string; totalCount: number; totalDistance: number; months: Record<string, { count: number; distance: number }> }> = {};

        filteredLogs.forEach(l => {
            const d = getLogDate(l);
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
                ...recentKeys.reduce((acc, mk) => {
                    const label = MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
                    acc[`${label}_count`] = d.months[mk]?.count || 0;
                    acc[`${label}_distance`] = d.months[mk]?.distance || 0;
                    return acc;
                }, {} as Record<string, number>),
                monthLabels: recentKeys.map(mk => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1]),
            }));
    }, [filteredLogs, monthKeys]);

    /** 차량별 가동률 */
    const vehicleUtilization = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        const totalWorkdays = recentKeys.reduce((s: number, k: string) => s + getWorkdaysInMonth(k), 0);

        const daysByVehicle: Record<string, Set<string>> = {};
        filteredLogs.forEach(l => {
            const d = getLogDate(l);
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
    }, [filteredLogs, vehicles, monthKeys]);

    /** 요일 × 시간대 히트맵 */
    const heatmapData = useMemo(() => calcHeatmapData(filteredLogs), [filteredLogs]);

    // ============================================================
    // 비용 최적화 데이터
    // ============================================================

    /** 차량별 km당 연료비 */
    const fuelEfficiency = useMemo(() => {
        const map: Record<string, { totalDist: number; totalCost: number }> = {};
        filteredLogs.forEach(l => {
            const name = l.vehicleDisplayName || l.vehicleName || '(미지정)';
            const dist = ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
            const cost = l.fuelAmount || l.energyCost || 0;
            if (dist <= 0) return;
            if (!map[name]) map[name] = { totalDist: 0, totalCost: 0 };
            map[name].totalDist += dist;
            map[name].totalCost += cost;
        });

        const result = Object.entries(map)
            .filter(([, v]) => (v as { totalDist: number; totalCost: number }).totalDist > 0 && (v as { totalDist: number; totalCost: number }).totalCost > 0)
            .map(([name, v]) => {
                const val = v as { totalDist: number; totalCost: number };
                return {
                    name,
                    totalDist: val.totalDist,
                    totalCost: val.totalCost,
                    costPerKm: Math.round((val.totalCost / val.totalDist) * 10) / 10,
                };
            })
            .sort((a, b) => b.costPerKm - a.costPerKm);

        const avgCostPerKm = result.length > 0
            ? Math.round((result.reduce((s, r) => s + r.costPerKm, 0) / result.length) * 10) / 10
            : 0;

        return { items: result, avgCostPerKm };
    }, [filteredLogs]);

    /** 차량별 정비비 분석 */
    const maintenanceCostAnalysis = useMemo(() => {
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
    }, [vehicles, maintenanceRecords]);

    /** 비정상 운행 탐지 */
    const anomalies = useMemo(() => detectAnomalies(filteredLogs), [filteredLogs]);

    /** 월별 주유비 + 하이패스 충전비 + 정비비 트렌드 */
    const costTrend = useMemo(() => {
        // 주유비 월별 집계
        const fuelByMonth: Record<string, number> = {};
        fuelLogs.forEach(l => {
            if (!l.date) return;
            const mk = l.date.slice(0, 7);
            if (!monthKeys.includes(mk)) return;
            if (!fuelByMonth[mk]) fuelByMonth[mk] = 0;
            fuelByMonth[mk] += l.fuelCost || 0;
        });

        // 하이패스 충전비 월별 집계
        const hipassByMonth: Record<string, number> = {};
        hipassCharges.forEach(l => {
            if (!l.date) return;
            const mk = l.date.slice(0, 7);
            if (!monthKeys.includes(mk)) return;
            if (!hipassByMonth[mk]) hipassByMonth[mk] = 0;
            hipassByMonth[mk] += l.chargeAmount || 0;
        });

        // 정비비 월별 집계
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
    }, [fuelLogs, hipassCharges, maintenanceRecords, monthKeys]);

    const totalFuelCost = useMemo(() => costTrend.reduce((s, c) => s + c.fuelCost, 0), [costTrend]);
    const totalHipassCost = useMemo(() => costTrend.reduce((s, c) => s + c.hipassCost, 0), [costTrend]);
    const totalMaintenanceCost = useMemo(() => costTrend.reduce((s, c) => s + c.maintenanceCost, 0), [costTrend]);
    const totalOperatingCost = useMemo(() => totalFuelCost + totalHipassCost + totalMaintenanceCost, [totalFuelCost, totalHipassCost, totalMaintenanceCost]);

    /** 최적화 추천 카드 생성 */
    const recommendations = useMemo(() => {
        const items: Array<{ type: string; icon: string; priority: string; title: string; desc: string }> = [];

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

            // 마지막 정비 후 90일 이상 경과
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
    }, [fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys]);

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
