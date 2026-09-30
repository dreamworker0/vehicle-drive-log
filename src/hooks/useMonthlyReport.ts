/**
 * useMonthlyReport — 운행 통계 보고서 상태 + 로직
 * MonthlyReport에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getFuelLogs, getAllHipassCharges } from '../lib/firestore';
import { getAllDriveLogsForExport } from '../lib/firestore/driveLogs/queries';
import { captureError } from '../lib/sentry';
import { toLocalDateStr } from '../lib/dateUtils';
import { extractDateStr, logDistance } from './utils/aggregationUtils';
import {
    calcDriveStats, filterPrevPeriodLogs, calcComparePeriod,
    calcFuelStats, calcHipassStats, calcCostTrend,
    formatDriverData, formatVehicleData, formatPurposeData,
    formatDailyTrendData,
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
    /** 불러오기 실패 안내 — 조용히 0을 보여 주면 "운행이 없다"로 읽힌다 */
    const [loadError, setLoadError] = useState<string | null>(null);
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


    // 비교 구간 — 1일부터 보는 기간은 앞선 달의 같은 날짜들(calcComparePeriod 참고)
    const comparePeriod = useMemo(() => calcComparePeriod(startDate, endDate), [startDate, endDate]);
    const prevStartDate = comparePeriod.start;

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        // 시작일이 종료일보다 늦으면 조회하지 않는다(날짜를 고치는 중간 상태)
        if (startDate > endDate) { setLoading(false); return; }
        let cancelled = false;
        const fetchData = async () => {
            setLoading(true);
            setLoadError(null);
            try {
                // 선택 기간 + 비교 구간만 서버에서 조회 (Firestore 읽기 비용 절감)
                const sinceDate = new Date(`${prevStartDate}T00:00:00`);
                const untilDate = new Date(`${endDate}T23:59:59`);

                // 운행일지는 **끝까지** 읽는다. 예전에는 limit 500에서 조용히 잘려(차량 10대면 보름치)
                // 최근 3개월의 총계·엑셀이 모자랐고, 최신순이라 비교 구간이 먼저 잘려 증감률이 부풀었다.
                // 내보내기와 같은 상한(5,000)을 넘으면 오류로 알린다 — 잘린 숫자를 보여 주지 않는다.
                const [driveResult, fuelResult, hipassResult] = await Promise.all([
                    getAllDriveLogsForExport(orgId!, { startDate: prevStartDate, endDate }),
                    getFuelLogs(orgId!, null, { since: sinceDate, until: untilDate }),
                    getAllHipassCharges(orgId!, { since: sinceDate, until: untilDate }),
                ]);
                if (cancelled) return;
                setLogs(driveResult as DriveLog[]);
                setFuelLogs(fuelResult as FuelLog[]);
                setHipassCharges(hipassResult as HipassCharge[]);
            } catch (err) {
                if (cancelled) return;
                captureError(err, { context: 'useMonthlyReport.load', orgId });
                const message = err instanceof Error && err.message.includes('초과')
                    ? `${err.message} (비교 구간 ${comparePeriod.start}~${comparePeriod.end}까지 함께 읽습니다)`
                    : '통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
                setLoadError(message);
                setLogs([]);
                setFuelLogs([]);
                setHipassCharges([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        // 날짜를 타이핑하는 동안 매 글자마다 다시 읽지 않도록 잠깐 기다린다
        const timer = setTimeout(fetchData, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [orgId, startDate, endDate, prevStartDate, comparePeriod.start, comparePeriod.end]);

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

    const fuelLogStats = useMemo(
        () => calcFuelStats(fuelLogs, startDate, endDate),
        [fuelLogs, startDate, endDate]
    );

    const driverData = useMemo(() => formatDriverData(stats.byDriver), [stats.byDriver]);
    const vehicleData = useMemo(
        () => formatVehicleData(stats.byVehicle, fuelLogStats.costByVehicleId),
        [stats.byVehicle, fuelLogStats.costByVehicleId]
    );
    const purposeData = useMemo(() => formatPurposeData(stats.byPurpose), [stats.byPurpose]);
    const dailyTrendData = useMemo(() => formatDailyTrendData(stats.byDate), [stats.byDate]);

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

        // 출발지는 기록에 있을 때만 열을 만든다 — 분관을 쓰지 않는 기관의 파일은 예전 그대로다.
        const includeStartLocation = filteredLogs.some(l => (l.startLocation || '').trim() !== '');
        const headers = ['날짜', '운전자', '차량', ...(includeStartLocation ? ['출발지'] : []), '도착지', '출발(km)', '도착(km)', '주행거리(km)', '목적', '출발시간', '도착시간'];
        const rows = filteredLogs.map(l => {
            const ts = (l.timestamp as { toDate?: () => Date })?.toDate?.();
            return [
            extractDateStr(l) || (ts ? toLocalDateStr(ts) : ''),
            l.driverName || '',
            l.vehicleDisplayName || l.vehicleName || '',
            ...(includeStartLocation ? [l.startLocation || ''] : []),
            l.destination || '',
            l.startKm || 0,
            l.endKm || 0,
            logDistance(l),
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
            ...(includeStartLocation ? [{ wch: 14 }] : []), // 출발지
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
        loading, loadError, startDate, endDate,
        setStartDate: handleStartDate, setEndDate: handleEndDate,
        activePeriod, setPeriod, comparePeriod,
        filteredLogs, stats, driverData, vehicleData, purposeData,
        dailyTrendData, dayOfWeekData, hourlyData,
        fuelLogStats, hipassChargeStats, costTrendData,
        exportExcel, exportPdf,
    };
}
