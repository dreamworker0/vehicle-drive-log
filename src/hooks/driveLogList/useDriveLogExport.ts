/**
 * driveLogList/useDriveLogExport — 운행일지 엑셀/PDF 내보내기 훅.
 * useDriveLogList에서 추출: 기간 검증 → 전체 데이터 로드 → 검색 필터 적용 → PDF/Excel 직렬화.
 * 목록 상태(logs/페이지네이션)에 부작용이 없는 읽기 전용 흐름이라 독립 훅으로 분리한다.
 */
import { useState } from 'react';
import { useToast } from '../useToast';
import { getAllDriveLogsForExport, getFuelLogs } from '../../lib/firestore';
import { attachFuelSummary } from '../../lib/driveLogExportFields';
import { matchesSearch } from './matchesSearch';
import type { DriveLogEntry } from '../../types/driveLog';

export interface ExportFilters {
    vehicleId: string;
    driverUid: string;
    search: string;
    startDate: string;
    endDate: string;
}

export interface ExportOrgInfo {
    name?: string;
    hideApprovalLine?: boolean;
    approvalLine?: { title: string }[];
    [key: string]: unknown;
}

export function useDriveLogExport(
    orgId: string | null | undefined,
    filters: ExportFilters,
    org: ExportOrgInfo | null,
) {
    const { showToast } = useToast();
    const [includeHipass, setIncludeHipass] = useState(false);
    const [includePassengers, setIncludePassengers] = useState(false);
    const [includeFuel, setIncludeFuel] = useState(false);

    // 내보내기 유효성 검사 (기간 필수 + 최대 3개월)
    const validateExportDates = (format: string): string | null => {
        if (!filters.startDate || !filters.endDate) {
            showToast('기간을 선택해주세요. (최대 3개월)', 'warning');
            return null;
        }
        const start = new Date(filters.startDate);
        const end = new Date(filters.endDate);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs < 0) { showToast('종료일이 시작일보다 앞섭니다.', 'warning'); return null; }
        if (diffMs > 92 * 24 * 60 * 60 * 1000) {
            showToast(`${format} 다운로드는 최대 3개월까지 가능합니다.`, 'warning');
            return null;
        }
        return format === 'PDF'
            ? `${filters.startDate} ~ ${filters.endDate}`
            : `${filters.startDate}~${filters.endDate}`;
    };

    // 서버에서 전체 데이터를 받아 직렬화
    const handleServerExport = async (period: string, hipass: boolean, passengers: boolean, fuel: boolean, isPdf: boolean) => {
        if (!orgId) return;
        showToast('전체 데이터를 불러오고 있습니다. 잠시만 기다려주세요.', 'info');
        try {
            const allLogs = await getAllDriveLogsForExport(orgId, {
                vehicleId: filters.vehicleId || undefined,
                driverUid: filters.driverUid || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined
            });
            const finalLogs = filters.search
                ? (allLogs as unknown as DriveLogEntry[]).filter(log => matchesSearch(log, filters.search))
                : (allLogs as unknown as DriveLogEntry[]);
            if (finalLogs.length === 0) {
                showToast('추출할 데이터가 없습니다.', 'warning');
                return;
            }
            // 주유 포함 시 별도 컬렉션의 주유 기록을 조회해 차량+날짜로 조인 (그날 첫 운행 행에만 부착)
            if (fuel) {
                const fuelLogs = await getFuelLogs(orgId, filters.vehicleId || null, {
                    since: filters.startDate || undefined,
                    until: filters.endDate || undefined,
                });
                attachFuelSummary(finalLogs, fuelLogs);
            }
            if (isPdf) {
                const { downloadDriveLogsPdf } = await import('../../lib/pdf/pdfExport');
                const defaultApproval = [{ title: '담당' }, { title: '팀장' }];
                const useApproval = org?.hideApprovalLine
                    ? []
                    : ((org?.approvalLine?.length ?? 0) > 0 ? org!.approvalLine! : defaultApproval);
                downloadDriveLogsPdf(finalLogs, {
                    orgName: org?.name || '',
                    period,
                    approvalLine: useApproval,
                    includeHipass: hipass,
                    includePassengers: passengers,
                    includeFuel: fuel,
                    onError: (msg) => showToast(msg, 'error'),
                });
            } else {
                const { downloadDriveLogsExcel } = await import('../../lib/excelExport');
                await downloadDriveLogsExcel(finalLogs, `운행일지_${period}`, {
                    onError: (msg) => showToast(msg, 'warning'),
                    includeHipass: hipass,
                    includePassengers: passengers,
                    includeFuel: fuel,
                });
            }
        } catch (err) {
            console.error('Export 데이터 로드 실패:', err);
            const msg = err instanceof Error && err.message ? err.message : '데이터를 불러오는데 실패했습니다.';
            showToast(msg, 'error');
        }
    };

    const handleExportExcel = () => {
        const period = validateExportDates('엑셀');
        if (period) handleServerExport(period, includeHipass, includePassengers, includeFuel, false);
    };

    const handleExportPdf = () => {
        const period = validateExportDates('PDF');
        if (period) handleServerExport(period, includeHipass, includePassengers, includeFuel, true);
    };

    return {
        includeHipass, setIncludeHipass,
        includePassengers, setIncludePassengers,
        includeFuel, setIncludeFuel,
        handleExportExcel, handleExportPdf,
    };
}
