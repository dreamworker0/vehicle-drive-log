/**
 * useMonthlyReport — 운행 통계 보고서 상태 + 로직
 * MonthlyReport에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getDriveLogs, getFuelLogs, getAllHipassCharges } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import { extractDateStr } from './utils/aggregationUtils';
import {
    calcDriveStats, filterPrevPeriodLogs,
    calcFuelStats, calcHipassStats, calcCostTrend,
    formatDriverData, formatVehicleData, formatPurposeData,
    formatVehicleFuelData, formatDailyTrendData,
} from './utils/monthlyReportCalc';
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


    // 전월 비교 기간 계산
    const prevStartDate = useMemo(() => {
        const s = new Date(startDate);
        const e = new Date(endDate);
        const daysDiff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
        const prevEnd = new Date(s);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - daysDiff);
        return toLocalDateStr(prevStart);
    }, [startDate, endDate]);

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchData = async () => {
            setLoading(true);
            try {
                // 선택 기간 + 전월 비교 기간만 서버에서 조회 (Firestore 읽기 비용 절감)
                const sinceDate = new Date(`${prevStartDate}T00:00:00`);
                const untilDate = new Date(`${endDate}T23:59:59`);

                const [driveResult, fuelResult, hipassResult] = await Promise.all([
                    getDriveLogs(orgId!, { limit: 500, startDate: prevStartDate, endDate }),
                    getFuelLogs(orgId!, null, { since: sinceDate, until: untilDate }).catch(() => []),
                    getAllHipassCharges(orgId!, { since: sinceDate, until: untilDate }).catch(() => []),
                ]);
                setLogs(driveResult.docs as DriveLog[]);
                setFuelLogs(fuelResult as FuelLog[]);
                setHipassCharges(hipassResult as HipassCharge[]);
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [orgId, startDate, endDate, prevStartDate]);

    const filteredLogs = useMemo(
        () => logs.filter(l => {
            const d = extractDateStr(l);
            if (!d) return false;
            return d >= startDate && d <= endDate;
        }),
        [logs, startDate, endDate]
    );

    // 전월 동기간 데이터
    const prevPeriodLogs = useMemo(
        () => filterPrevPeriodLogs(logs, startDate, endDate),
        [logs, startDate, endDate]
    );

    const stats = useMemo(
        () => calcDriveStats(filteredLogs, prevPeriodLogs, startDate, endDate),
        [filteredLogs, prevPeriodLogs, startDate, endDate]
    );

    const driverData = useMemo(() => formatDriverData(stats.byDriver), [stats.byDriver]);
    const vehicleData = useMemo(() => formatVehicleData(stats.byVehicle, stats.byVehicleFuel), [stats.byVehicle, stats.byVehicleFuel]);
    const purposeData = useMemo(() => formatPurposeData(stats.byPurpose), [stats.byPurpose]);
    const vehicleFuelData = useMemo(() => formatVehicleFuelData(stats.byVehicleFuel), [stats.byVehicleFuel]);
    const dailyTrendData = useMemo(() => formatDailyTrendData(stats.byDate), [stats.byDate]);

    const fuelLogStats = useMemo(
        () => calcFuelStats(fuelLogs, startDate, endDate),
        [fuelLogs, startDate, endDate]
    );

    const hipassChargeStats = useMemo(
        () => calcHipassStats(hipassCharges, startDate, endDate),
        [hipassCharges, startDate, endDate]
    );

    const costTrendData = useMemo(
        () => calcCostTrend(fuelLogs, hipassCharges, startDate, endDate),
        [fuelLogs, hipassCharges, startDate, endDate]
    );

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
        const rows = filteredLogs.map(l => {
            const ts = (l.timestamp as { toDate?: () => Date })?.toDate?.();
            return [
            l.date || (ts ? toLocalDateStr(ts) : ''),
            l.driverName || '',
            l.vehicleDisplayName || l.vehicleName || '',
            l.destination || '',
            l.startKm || 0,
            l.endKm || 0,
            (l.endKm - l.startKm) || 0,
            l.purpose || '',
            l.startTime || '',
            l.endTime || '',
            ];
        });

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
