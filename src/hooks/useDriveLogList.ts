/**
 * useDriveLogList — 운행일지 목록 데이터 fetching, 페이지네이션, 중복 검사, 내보내기 핸들러
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { getDriveLogs, getVehicles, getOrganizationMembers, getOrganization, cleanupDuplicateLogs, deleteDriveLog, getAllDriveLogsForExport } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import type { DocumentSnapshot } from 'firebase/firestore';

interface DriveLogEntry {
    id: string;
    vehicleId?: string;
    vehicleName?: string;
    driverUid?: string;
    driverName?: string;
    date?: string;
    startKm: number;
    endKm: number;
    startTime?: string;
    endTime?: string;
    destination?: string;
    purpose?: string;
    passengerCount?: number;
    timestamp?: { toDate: () => Date };
    [key: string]: unknown;
}

interface VehicleEntry {
    id: string;
    displayName?: string;
    [key: string]: unknown;
}

interface MemberEntry {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
}

interface DupResult {
    deleteCount: number;
    duplicateGroups: number;
    totalLogs: number;
}

interface OrgInfo {
    name?: string;
    hideApprovalLine?: boolean;
    approvalLine?: { title: string }[];
    [key: string]: unknown;
}

const PAGE_SIZE = 50;

export default function useDriveLogList() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [logs, setLogs] = useState<DriveLogEntry[]>([]);
    const [vehicles, setVehicles] = useState<VehicleEntry[]>([]);
    const [members, setMembers] = useState<MemberEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [org, setOrg] = useState<OrgInfo | null>(null);
    const [dupState, setDupState] = useState<'idle' | 'scanning' | 'result' | 'cleaning'>('idle');
    const [dupResult, setDupResult] = useState<DupResult | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [includeHipass, setIncludeHipass] = useState(false);
    const [includePassengers, setIncludePassengers] = useState(false);

    const now = new Date();
    const firstDay = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastDay = toLocalDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const [filters, setFilters] = useState({
        vehicleId: '',
        driverUid: '',
        search: '',
        startDate: firstDay,
        endDate: lastDay,
    });

    const orgId = userData?.organizationId;

    // 필터 변경 시 이전 요청의 응답이 나중에 도착해 최신 상태를 덮어쓰는 걸 방지
    const requestIdRef = useRef(0);

    // 초기 데이터 로드
    useEffect(() => {
        if (!orgId) return;
        const myRequestId = ++requestIdRef.current;
        const fetchData = async () => {
            setLoading(true);
            try {
                const [result, v, m, orgData] = await Promise.all([
                    getDriveLogs(orgId, {
                        limit: PAGE_SIZE,
                        vehicleId: filters.vehicleId || undefined,
                        driverUid: filters.driverUid || undefined,
                        startDate: filters.startDate || undefined,
                        endDate: filters.endDate || undefined
                    }),
                    getVehicles(orgId),
                    getOrganizationMembers(orgId),
                    getOrganization(orgId),
                ]);
                if (myRequestId !== requestIdRef.current) return; // stale 응답 폐기
                setLogs(result.docs as unknown as DriveLogEntry[]);
                setLastDoc(result.lastDoc as DocumentSnapshot | null);
                setHasMore(result.hasMore);
                setVehicles(v as unknown as VehicleEntry[]);
                setMembers((m as MemberEntry[]).filter(x => x.role !== 'superAdmin'));
                setOrg(orgData as OrgInfo | null);
            } catch (err) {
                if (myRequestId !== requestIdRef.current) return;
                console.error('데이터 로드 실패:', err);
            } finally {
                if (myRequestId === requestIdRef.current) setLoading(false);
            }
        };
        fetchData();
    }, [orgId, filters.vehicleId, filters.driverUid, filters.startDate, filters.endDate]);

    // 더보기
    const loadMore = async () => {
        if (!lastDoc || !hasMore || loadingMore) return;
        const myRequestId = requestIdRef.current; // 현재 필터 세대
        setLoadingMore(true);
        try {
            const result = await getDriveLogs(orgId!, {
                limit: PAGE_SIZE,
                startAfter: lastDoc,
                vehicleId: filters.vehicleId || undefined,
                driverUid: filters.driverUid || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined
            });
            if (myRequestId !== requestIdRef.current) return; // 필터가 바뀌었으면 결과 폐기
            setLogs(prev => [...prev, ...result.docs as unknown as DriveLogEntry[]]);
            setLastDoc(result.lastDoc as DocumentSnapshot | null);
            setHasMore(result.hasMore);
        } catch (err) {
            if (myRequestId !== requestIdRef.current) return;
            console.error('추가 로드 실패:', err);
            showToast('추가 데이터를 불러오지 못했습니다.', 'error');
        } finally {
            if (myRequestId === requestIdRef.current) setLoadingMore(false);
        }
    };

    // 검색 필터링
    const filteredLogs = logs.filter(log => {
        if (filters.search) {
            const s = filters.search.toLowerCase();
            return (
                log.driverName?.toLowerCase().includes(s) ||
                log.vehicleName?.toLowerCase().includes(s) ||
                log.purpose?.toLowerCase().includes(s) ||
                log.destination?.toLowerCase().includes(s)
            );
        }
        return true;
    });

    const totalDistance = filteredLogs.reduce((sum, l) => sum + ((l.endKm - l.startKm) || 0), 0);

    // 삭제
    const handleDelete = async (logId: string, driverName: string) => {
        if (!await confirm({ message: `${driverName || '(이름 없음)'}님의 운행 기록을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, confirmColor: 'danger' })) return;
        setDeletingId(logId);
        try {
            await deleteDriveLog(logId);
            setLogs(prev => prev.filter(l => l.id !== logId));
            showToast('운행 기록이 삭제되었습니다.', 'success');
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    // 중복 검사
    const handleDupScan = async () => {
        setDupState('scanning');
        setDupResult(null);
        try {
            const result = await cleanupDuplicateLogs(orgId!, { dryRun: true });
            setDupResult(result as DupResult);
            setDupState((result as DupResult).deleteCount > 0 ? 'result' : 'idle');
            if ((result as DupResult).deleteCount === 0) {
                showToast('중복 데이터가 없습니다.', 'success');
            }
        } catch (err) {
            console.error('중복 검사 실패:', err);
            showToast('중복 검사에 실패했습니다.', 'error');
            setDupState('idle');
        }
    };

    // 중복 정리
    const handleDupClean = async () => {
        if (!dupResult) return;
        if (!await confirm({ message: `정말 ${dupResult.deleteCount}건의 중복 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`, confirmColor: 'danger' })) return;
        setDupState('cleaning');
        try {
            const result = await cleanupDuplicateLogs(orgId!, { dryRun: false });
            showToast(`${(result as DupResult).deleteCount}건의 중복 데이터가 삭제되었습니다.`, 'success');
            setDupState('idle');
            setDupResult(null);
            // 목록 새로고침
            setLoading(true);
            const [refreshed, v, m] = await Promise.all([
                getDriveLogs(orgId!, { limit: PAGE_SIZE }),
                getVehicles(orgId!),
                getOrganizationMembers(orgId!),
            ]);
            setLogs(refreshed.docs as unknown as DriveLogEntry[]);
            setLastDoc(refreshed.lastDoc as DocumentSnapshot | null);
            setHasMore(refreshed.hasMore);
            setVehicles(v as unknown as VehicleEntry[]);
            setMembers((m as MemberEntry[]).filter(x => x.role !== 'superAdmin'));
            setLoading(false);
        } catch (err) {
            console.error('중복 정리 실패:', err);
            showToast('중복 정리에 실패했습니다.', 'error');
            setDupState('result');
        }
    };

    const handleDupCancel = () => {
        setDupState('idle');
        setDupResult(null);
    };

    // 내보내기 유효성 검사
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

    // 서버 내보내기
    const handleServerExport = async (period: string, hipass: boolean, passengers: boolean, isPdf: boolean) => {
        if (!orgId) return;
        showToast('전체 데이터를 불러오고 있습니다. 잠시만 기다려주세요.', 'info');
        try {
            const allLogs = await getAllDriveLogsForExport(orgId, {
                vehicleId: filters.vehicleId || undefined,
                driverUid: filters.driverUid || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined
            });
            const finalLogs = (allLogs as unknown as DriveLogEntry[]).filter((log: DriveLogEntry) => {
                if (filters.search) {
                    const s = filters.search.toLowerCase();
                    return (
                        log.driverName?.toLowerCase().includes(s) ||
                        log.vehicleName?.toLowerCase().includes(s) ||
                        log.purpose?.toLowerCase().includes(s) ||
                        log.destination?.toLowerCase().includes(s)
                    );
                }
                return true;
            });
            if (finalLogs.length === 0) {
                showToast('추출할 데이터가 없습니다.', 'warning');
                return;
            }
            if (isPdf) {
                const { downloadDriveLogsPdf } = await import('../lib/pdf/pdfExport');
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
                    onError: (msg) => showToast(msg, 'error'),
                });
            } else {
                const { downloadDriveLogsExcel } = await import('../lib/excelExport');
                await downloadDriveLogsExcel(finalLogs, `운행일지_${period}`, {
                    onError: (msg) => showToast(msg, 'warning'),
                    includeHipass: hipass,
                    includePassengers: passengers,
                });
            }
        } catch (err) {
            console.error('Export 데이터 로드 실패:', err);
            showToast('데이터를 불러오는데 실패했습니다.', 'error');
        }
    };

    const handleExportExcel = () => {
        const period = validateExportDates('엑셀');
        if (period) handleServerExport(period, includeHipass, includePassengers, false);
    };

    const handleExportPdf = () => {
        const period = validateExportDates('PDF');
        if (period) handleServerExport(period, includeHipass, includePassengers, true);
    };

    return {
        // 상태
        logs, vehicles, members, loading, loadingMore, hasMore,
        filters, setFilters, filteredLogs, totalDistance,
        deletingId, includeHipass, setIncludeHipass, includePassengers, setIncludePassengers,
        dupState, dupResult,
        // 핸들러
        loadMore, handleDelete,
        handleDupScan, handleDupClean, handleDupCancel,
        handleExportExcel, handleExportPdf,
    };
}
