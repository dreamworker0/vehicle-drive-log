import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getOrganizationMembers } from '../lib/firestore';
import { getMonthlyStats, MonthlyStat, type DriveOriginCounts } from '../lib/firestore/statistics';
import type { Vehicle } from '../types/vehicle';
import type { User } from '../types/user';
import { getRecentMonthKeys } from './utils/aggregationUtils';
import {
    DAY_NAMES, MONTH_LABELS, countWorkdays, calcRecommendations, calcMonthOverMonth,
} from './utils/analyticsCalc';
import { fetchPublicHolidays } from '../lib/holidayApi';
import type { CostTrendItem, DriverComparisonItem } from './utils/analyticsCalc';

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

    /** 월별 운행 방식 — 사전 예약 · 바로 운행 · 예약 없이 기록 · 예약 연결(구분 전) */
    const driveOriginTrend = useMemo(() => {
        return monthKeys.map(mk => {
            const o = stats.find(s => s.monthKey === mk)?.originCounts;
            return {
                month: mk,
                label: MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1],
                reservation: o?.reservation || 0,
                quick: o?.quick || 0,
                manual: o?.manual || 0,
                linked: o?.linked || 0,
            };
        });
    }, [stats, monthKeys]);

    /**
     * 직원별·차량별 운행 방식 — 분석 기간 전체 합계, 운행이 많은 순 상위 10.
     * 이 필드가 생기기 전의 월간 문서는 origin이 없어 건너뛴다(그 달은 0으로 센다).
     */
    const driveOriginBy = useMemo(() => {
        type Row = { name: string; reservation: number; quick: number; manual: number; linked: number; total: number };
        const collect = (pick: (s: MonthlyStat) => Record<string, { name?: string; origin?: DriveOriginCounts }>) => {
            const map: Record<string, Row> = {};
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
    }, [stats]);

    const driverComparison = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        const map: Record<string, { name: string, totalCount: number, totalDistance: number, months: Record<string, {count: number, distance: number}> }> = {};
        
        recentKeys.forEach(mk => {
            const stat = stats.find(s => s.monthKey === mk);
            if (stat?.driverStats) {
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
            }
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
                const label = MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1];
                acc[`${label}_count`] = d.months[mk]?.count || 0;
                acc[`${label}_distance`] = d.months[mk]?.distance || 0;
                return acc;
            }, {} as Record<string, number>),
            monthLabels: recentKeys.map(mk => MONTH_LABELS[parseInt(mk.split('-')[1], 10) - 1]),
        })).sort((a, b) => b.totalCount - a.totalCount);
    }, [stats, monthKeys]);

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

    const vehicleUtilization = useMemo(() => {
        const recentKeys = monthKeys.slice(-3);
        // 공휴일을 빼고, 진행 중인 이번 달은 오늘까지만 센다
        const totalWorkdays = recentKeys.reduce((s, k) => s + countWorkdays(k, holidays), 0);
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
            // 주말·공휴일 운행도 가동일에 들어가 분모(평일)를 넘을 수 있다 — 100%에서 멈춘다
            const rate = totalWorkdays > 0 ? Math.min(100, Math.round((usedDays / totalWorkdays) * 100)) : 0;
            return { name, usedDays, totalWorkdays, rate };
        }).sort((a, b) => b.rate - a.rate);
    }, [stats, vehicles, monthKeys, holidays]);

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
                costPerKm: currentKm > 0 ? Math.round((maint.totalCost / currentKm) * 100) / 100 : 0,
                insuranceExpiryDate: v.insurance?.expiryDate,
                retired: !!v.retired?.isRetired,
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
    /** 하이패스 실제 사용액 합 — 사용액을 담은 달이 하나도 없으면(집계 도입 전) null */
    const totalHipassUsed = useMemo(() => {
        const months = stats.filter(s => monthKeys.includes(s.monthKey) && s.hipassUsed !== null);
        return months.length ? months.reduce((sum, s) => sum + (s.hipassUsed || 0), 0) : null;
    }, [stats, monthKeys]);

    /** 전월 대비 — 다 끝난 지난달과 그 전달 */
    const monthOverMonth = useMemo(() => calcMonthOverMonth(monthlyTrend.map((m, i) => ({
        month: m.month, count: m.count, distance: m.distance, cost: costTrend[i]?.totalCost || 0,
    }))), [monthlyTrend, costTrend]);

    const recommendations = useMemo(() => calcRecommendations({
        fuelEfficiency, driverComparison: driverComparison as DriverComparisonItem[], maintenanceCostAnalysis,
        anomalies, vehicleUtilization, monthKeys, rangeMonths,
    }), [fuelEfficiency, driverComparison, maintenanceCostAnalysis, anomalies, vehicleUtilization, monthKeys, rangeMonths]);

    const totalLogs = useMemo(() => stats.reduce((s, st) => s + (st.totalLogs || 0), 0), [stats]);

    /** 가장 최근 집계 시각 — 화면에 "언제 기준 숫자인지" 적는다 */
    const aggregatedAt = useMemo(() => {
        const times = stats.map(s => s.updatedAt?.getTime() || 0).filter(t => t > 0);
        return times.length ? new Date(Math.max(...times)) : null;
    }, [stats]);

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
