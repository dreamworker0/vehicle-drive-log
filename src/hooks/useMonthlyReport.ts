/**
 * useMonthlyReport — 운행 통계 보고서 상태 + 로직
 * MonthlyReport에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getDriveLogs } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import type { DriveLog } from '../types/driveLog';



const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function useMonthlyReport() {
    const { userData } = useAuth();
    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [activePeriod, setActivePeriod] = useState<string | null>('thisMonth');

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const [startDate, setStartDate] = useState(toLocalDateStr(firstDay));
    const [endDate, setEndDate] = useState(toLocalDateStr(now));

    const orgId = userData?.organizationId;

    // 빠른 기간 선택 프리셋
    const setPeriod = useCallback((period: string) => {
        const today = new Date();
        let start, end;

        switch (period) {
            case 'thisWeek': {
                const day = today.getDay();
                const diff = day === 0 ? 6 : day - 1; // 월요일 시작
                start = new Date(today);
                start.setDate(today.getDate() - diff);
                end = today;
                break;
            }
            case 'thisMonth': {
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                end = today;
                break;
            }
            case 'lastMonth': {
                start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                end = new Date(today.getFullYear(), today.getMonth(), 0);
                break;
            }
            case 'last3Months': {
                start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
                end = today;
                break;
            }
            default:
                return;
        }

        setStartDate(toLocalDateStr(start));
        setEndDate(toLocalDateStr(end));
        setActivePeriod(period);
    }, []);

    // 날짜 직접 변경 시 activePeriod 초기화
    const handleStartDate = useCallback((val: string) => {
        setStartDate(val);
        setActivePeriod(null);
    }, []);

    const handleEndDate = useCallback((val: string) => {
        setEndDate(val);
        setActivePeriod(null);
    }, []);

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            setLoading(true);
            try {
                const result = await getDriveLogs(orgId, { limit: 500 });
                setLogs(result.docs);
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    const filteredLogs = useMemo(() =>
        logs.filter(l => {
            const d = l.date || (l.timestamp as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';
            if (!d) return false;
            return d >= startDate && d <= endDate;
        }),
        [logs, startDate, endDate]
    );

    // 전월 동기간 데이터
    const prevPeriodLogs = useMemo(() => {
        const s = new Date(startDate);
        const e = new Date(endDate);
        const daysDiff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
        const prevEnd = new Date(s);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - daysDiff);
        const ps = toLocalDateStr(prevStart);
        const pe = toLocalDateStr(prevEnd);

        return logs.filter(l => {
            const d = l.date || (l.timestamp as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';
            if (!d) return false;
            return d >= ps && d <= pe;
        });
    }, [logs, startDate, endDate]);

    const stats = useMemo(() => {
        const totalRuns = filteredLogs.length;
        const totalDistance = filteredLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
        const totalFuel = filteredLogs.reduce((s, l) => s + (l.fuelAmount || l.energyCost || 0), 0);

        const incompleteCount = filteredLogs.filter(l => l.isIncomplete).length;

        // 평균 지표
        const avgDistance = totalRuns > 0 ? Math.round(totalDistance / totalRuns) : 0;
        const s = new Date(startDate);
        const e = new Date(endDate);
        const daySpan = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const avgDailyRuns = totalRuns > 0 ? (totalRuns / daySpan).toFixed(1) : '0';

        // 전월 대비
        const prevRuns = prevPeriodLogs.length;
        const prevDistance = prevPeriodLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
        const prevFuel = prevPeriodLogs.reduce((s, l) => s + (l.fuelAmount || l.energyCost || 0), 0);

        const calcChange = (cur: number, prev: number) => {
            if (prev === 0) return cur > 0 ? 100 : 0;
            return Math.round(((cur - prev) / prev) * 100);
        };

        const runsChange = calcChange(totalRuns, prevRuns);
        const distanceChange = calcChange(totalDistance, prevDistance);
        const fuelChange = calcChange(totalFuel, prevFuel);

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
            const d = l.date || (l.timestamp as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';
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
    }, [filteredLogs, prevPeriodLogs, startDate, endDate]);

    const driverData = useMemo(() => {
        return Object.entries(stats.byDriver)
            .sort((a, b) => (b[1] as { distance: number }).distance - (a[1] as { distance: number }).distance)
            .map(([name, data]) => ({
                name,
                distance: data.distance,
                count: data.count,
                avgDistance: data.count > 0 ? Math.round(data.distance / data.count) : 0,
            }));
    }, [stats.byDriver]);

    const vehicleData = useMemo(() => {
        return Object.entries(stats.byVehicle)
            .sort((a, b) => (b[1] as { distance: number }).distance - (a[1] as { distance: number }).distance)
            .map(([name, data]) => ({
                name,
                distance: data.distance,
                count: data.count,
                fuel: stats.byVehicleFuel[name] || 0,
            }));
    }, [stats.byVehicle, stats.byVehicleFuel]);

    const purposeData = useMemo(() => {
        return Object.entries(stats.byPurpose)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .map(([name, value]) => ({ name, value: value as number }));
    }, [stats.byPurpose]);

    const vehicleFuelData = useMemo(() => {
        return Object.entries(stats.byVehicleFuel || {})
            .filter(([, v]) => (v as number) > 0)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .map(([name, amount]) => ({ name, amount: amount as number }));
    }, [stats.byVehicleFuel]);

    const dailyTrendData = useMemo(() => {
        return Object.entries(stats.byDate || {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, data]) => ({ date: date.slice(5), count: (data as { count: number; distance: number }).count, distance: (data as { count: number; distance: number }).distance }));
    }, [stats.byDate]);

    const dayOfWeekData = useMemo(() => {
        return stats.byDayOfWeek.map((data, idx) => ({
            name: DAY_NAMES[idx],
            count: data.count,
            distance: data.distance,
        }));
    }, [stats.byDayOfWeek]);

    const hourlyData = useMemo(() => {
        return stats.byHour.map((count, hour) => ({
            hour: `${hour}시`,
            count,
        }));
    }, [stats.byHour]);

    // CSV 내보내기
    const exportCSV = useCallback(() => {
        if (filteredLogs.length === 0) return;

        const headers = ['날짜', '운전자', '차량', '도착지', '출발(km)', '도착(km)', '주행거리(km)', '목적', '출발시간', '도착시간'];
        const rows = filteredLogs.map(l => [
            l.date || (l.timestamp as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) || '',
            l.driverName || '',
            l.vehicleDisplayName || l.vehicleName || '',
            l.destination || '',
            l.startKm || '',
            l.endKm || '',
            (l.endKm - l.startKm) || 0,
            l.purpose || '',
            l.startTime || '',
            l.endTime || '',
        ]);

        const bom = '\uFEFF';
        const csvContent = bom + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `운행통계_${startDate}_${endDate}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }, [filteredLogs, startDate, endDate]);

    return {
        loading, startDate, endDate,
        setStartDate: handleStartDate, setEndDate: handleEndDate,
        activePeriod, setPeriod,
        filteredLogs, stats, driverData, vehicleData, purposeData,
        vehicleFuelData, dailyTrendData, dayOfWeekData, hourlyData,
        exportCSV,
    };
}
