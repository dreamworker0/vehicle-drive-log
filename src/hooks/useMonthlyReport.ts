/**
 * useMonthlyReport — 운행 통계 보고서 상태 + 로직
 * MonthlyReport에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getDriveLogs, getFuelLogs, getAllHipassCharges } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import type { DriveLog } from '../types/driveLog';
import type { FuelLog } from '../types/fuelLog';
import type { HipassCharge } from '../types/hipassCharge';



const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function useMonthlyReport() {
    const { userData } = useAuth();
    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
    const [hipassCharges, setHipassCharges] = useState<HipassCharge[]>([]);
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
        if (!orgId) { setLoading(false); return; }
        const fetch = async () => {
            setLoading(true);
            try {
                const [driveResult, fuelResult, hipassResult] = await Promise.all([
                    getDriveLogs(orgId, { limit: 500 }),
                    getFuelLogs(orgId).catch(() => []),
                    getAllHipassCharges(orgId).catch(() => []),
                ]);
                setLogs(driveResult.docs);
                setFuelLogs(fuelResult as FuelLog[]);
                setHipassCharges(hipassResult as HipassCharge[]);
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

    /** 주유 통계 (기간 필터링) */
    const fuelLogStats = useMemo(() => {
        const filtered = fuelLogs.filter(l => l.date >= startDate && l.date <= endDate);
        const totalCost = filtered.reduce((s, l) => s + (l.fuelCost || 0), 0);
        const totalAmount = filtered.reduce((s, l) => s + (l.fuelAmount || 0), 0);

        // 차량별 집계
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
    }, [fuelLogs, startDate, endDate]);

    /** 하이패스 충전 통계 (기간 필터링) */
    const hipassChargeStats = useMemo(() => {
        const filtered = hipassCharges.filter(l => l.date >= startDate && l.date <= endDate);
        const totalAmount = filtered.reduce((s, l) => s + (l.chargeAmount || 0), 0);

        // 차량별 집계
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
    }, [hipassCharges, startDate, endDate]);

    /** 일별 비용 추이 (주유비 + 하이패스 누적) */
    const costTrendData = useMemo(() => {
        const byDate: Record<string, { fuel: number; hipass: number }> = {};

        // 주유비
        fuelLogs.filter(l => l.date >= startDate && l.date <= endDate).forEach(l => {
            if (!byDate[l.date]) byDate[l.date] = { fuel: 0, hipass: 0 };
            byDate[l.date].fuel += l.fuelCost || 0;
        });

        // 하이패스 충전비
        hipassCharges.filter(l => l.date >= startDate && l.date <= endDate).forEach(l => {
            if (!byDate[l.date]) byDate[l.date] = { fuel: 0, hipass: 0 };
            byDate[l.date].hipass += l.chargeAmount || 0;
        });

        return Object.entries(byDate)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, data]) => ({
                date: date.slice(5), // 'MM-DD'
                fuel: data.fuel,
                hipass: data.hipass,
                total: data.fuel + data.hipass,
            }));
    }, [fuelLogs, hipassCharges, startDate, endDate]);

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

    // 엑셀 내보내기
    const exportExcel = useCallback(async () => {
        if (filteredLogs.length === 0) return;

        const XLSX = await import('xlsx');

        const headers = ['날짜', '운전자', '차량', '도착지', '출발(km)', '도착(km)', '주행거리(km)', '목적', '출발시간', '도착시간'];
        const rows = filteredLogs.map(l => [
            l.date || (l.timestamp as { toDate?: () => Date })?.toDate?.()?.toISOString?.()?.slice(0, 10) || '',
            l.driverName || '',
            l.vehicleDisplayName || l.vehicleName || '',
            l.destination || '',
            l.startKm || 0,
            l.endKm || 0,
            (l.endKm - l.startKm) || 0,
            l.purpose || '',
            l.startTime || '',
            l.endTime || '',
        ]);

        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 컬럼 너비 자동 설정
        ws['!cols'] = [
            { wch: 12 }, // 날짜
            { wch: 10 }, // 운전자
            { wch: 14 }, // 차량
            { wch: 16 }, // 도착지
            { wch: 10 }, // 출발(km)
            { wch: 10 }, // 도착(km)
            { wch: 12 }, // 주행거리
            { wch: 12 }, // 목적
            { wch: 10 }, // 출발시간
            { wch: 10 }, // 도착시간
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '운행일지');
        XLSX.writeFile(wb, `운행통계_${startDate}_${endDate}.xlsx`);
    }, [filteredLogs, startDate, endDate]);

    // PDF 인쇄 (브라우저 인쇄 대화상자 → PDF 저장)
    const exportPdf = useCallback(() => {
        // 인쇄용 스타일 주입
        const style = document.createElement('style');
        style.id = 'print-style';
        style.textContent = `
            @media print {
                body * { visibility: hidden; }
                #monthly-report-print, #monthly-report-print * { visibility: visible; }
                #monthly-report-print { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
                .no-print { display: none !important; }
                @page { size: A4 landscape; margin: 15mm; }
            }
        `;
        document.head.appendChild(style);
        window.print();
        // 인쇄 후 스타일 제거
        setTimeout(() => {
            style.remove();
        }, 1000);
    }, []);

    return {
        loading, startDate, endDate,
        setStartDate: handleStartDate, setEndDate: handleEndDate,
        activePeriod, setPeriod,
        filteredLogs, stats, driverData, vehicleData, purposeData,
        vehicleFuelData, dailyTrendData, dayOfWeekData, hourlyData,
        fuelLogStats, hipassChargeStats, costTrendData,
        exportExcel, exportPdf,
    };
}
