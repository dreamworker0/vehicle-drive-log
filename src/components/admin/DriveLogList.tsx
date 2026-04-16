import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getDriveLogs, getVehicles, getOrganizationMembers, getOrganization, cleanupDuplicateLogs, deleteDriveLog, getAllDriveLogsForExport } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import { toLocalDateStr } from '../../lib/dateUtils';
import { SkeletonBox, SkeletonTable } from '../common/Skeleton';
import DriveLogFilters from './driveLogList/DriveLogFilters';
import DriveLogTableRow, { GRID_COLUMNS } from './driveLogList/DriveLogTableRow';
import DriveLogExportBar from './driveLogList/DriveLogExportBar';
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

export default function DriveLogList() {
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
    const PAGE_SIZE = 50;

    const handleServerExport = async (period: string, hipass: boolean, isPdf: boolean) => {
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
                    onError: (msg) => showToast(msg, 'error'),
                });
            } else {
                const { downloadDriveLogsExcel } = await import('../../lib/excelExport');
                await downloadDriveLogsExcel(finalLogs, `운행일지_${period}`, {
                    onError: (msg) => showToast(msg, 'warning'),
                    includeHipass: hipass,
                });
            }
        } catch (err) {
            console.error('Export 데이터 로드 실패:', err);
            showToast('데이터를 불러오는데 실패했습니다.', 'error');
        }
    };

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
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
                setLogs(result.docs as unknown as DriveLogEntry[]);
                setLastDoc(result.lastDoc as DocumentSnapshot | null);
                setHasMore(result.hasMore);
                setVehicles(v as unknown as VehicleEntry[]);
                setMembers((m as MemberEntry[]).filter(x => x.role !== 'superAdmin'));
                setOrg(orgData as OrgInfo | null);
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId, filters.vehicleId, filters.driverUid, filters.startDate, filters.endDate]);

    const loadMore = async () => {
        if (!lastDoc || !hasMore || loadingMore) return;
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
            setLogs(prev => [...prev, ...result.docs as unknown as DriveLogEntry[]]);
            setLastDoc(result.lastDoc as DocumentSnapshot | null);
            setHasMore(result.hasMore);
        } catch (err) {
            console.error('추가 로드 실패:', err);
            showToast('추가 데이터를 불러오지 못했습니다.', 'error');
        } finally {
            setLoadingMore(false);
        }
    };

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

    const handleExportExcel = () => {
        const period = validateExportDates('엑셀');
        if (period) handleServerExport(period, includeHipass, false);
    };

    const handleExportPdf = () => {
        const period = validateExportDates('PDF');
        if (period) handleServerExport(period, includeHipass, true);
    };

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-28 mb-1" />
                <SkeletonBox className="h-4 w-40 mb-6" />
                <SkeletonTable rows={6} cols={5} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <DriveLogExportBar
                filteredCount={filteredLogs.length}
                totalDistance={totalDistance}
                includeHipass={includeHipass}
                onIncludeHipassChange={setIncludeHipass}
                dupState={dupState}
                dupResult={dupResult}
                onDupScan={handleDupScan}
                onDupClean={handleDupClean}
                onDupCancel={handleDupCancel}
                onExportExcel={handleExportExcel}
                onExportPdf={handleExportPdf}
            />

            <DriveLogFilters
                filters={filters}
                onFiltersChange={setFilters}
                vehicles={vehicles}
                members={members}
            />

            {/* 목록 */}
            {filteredLogs.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="text-surface-400 font-medium">
                        {logs.length === 0 ? '운행 기록이 없습니다' : '검색 결과가 없습니다'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* 헤더 (데스크탑) */}
                    <div className="hidden sm:grid gap-2 px-4 py-2 text-xs font-medium text-surface-400" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                        <div>날짜</div>
                        <div>출발</div>
                        <div>도착</div>
                        <div>운전자</div>
                        <div>차량</div>
                        <div>목적지</div>
                        <div>출발/도착Km</div>
                        <div className="text-center">인원</div>
                        <div className="text-right">주행거리</div>
                        <div></div>
                    </div>

                    {filteredLogs.map(log => (
                        <DriveLogTableRow
                            key={log.id}
                            log={log}
                            deletingId={deletingId}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            {/* 더보기 버튼 */}
            {hasMore && !loading && (
                <div className="text-center mt-6">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="btn-secondary px-6 py-2 text-sm"
                    >
                        {loadingMore ? (
                            <span className="flex items-center gap-2">
                                <span className="w-4 h-4 spinner" />
                                불러오는 중...
                            </span>
                        ) : (
                            `더보기 (${logs.length}건 로드됨)`
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
