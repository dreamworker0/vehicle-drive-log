import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getDriveLogs, getVehicles, getOrganizationMembers, getOrganization, cleanupDuplicateLogs, deleteDriveLog } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { toLocalDateStr } from '../../lib/dateUtils';
import { SkeletonBox, SkeletonTable } from '../common/Skeleton';

export default function DriveLogList() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [logs, setLogs] = useState<any[]>([]);
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [members, setMembers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastDoc, setLastDoc] = useState<any>(null);
    const [hasMore, setHasMore] = useState(false);
    const [org, setOrg] = useState<any>(null);
    const [dupState, setDupState] = useState<string>('idle'); // idle | scanning | result | cleaning
    const [dupResult, setDupResult] = useState<any>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
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

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const [result, v, m, orgData] = await Promise.all([
                    getDriveLogs(orgId, { limit: PAGE_SIZE }),
                    getVehicles(orgId),
                    getOrganizationMembers(orgId),
                    getOrganization(orgId),
                ]);
                setLogs(result.docs);
                setLastDoc(result.lastDoc);
                setHasMore(result.hasMore);
                setVehicles(v);
                setMembers(m.filter(x => x.role !== 'superAdmin'));
                setOrg(orgData);
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    const loadMore = async () => {
        if (!lastDoc || !hasMore || loadingMore) return;
        setLoadingMore(true);
        try {
            const result = await getDriveLogs(orgId!, { limit: PAGE_SIZE, startAfter: lastDoc });
            setLogs(prev => [...prev, ...result.docs]);
            setLastDoc(result.lastDoc);
            setHasMore(result.hasMore);
        } catch (err) {
            console.error('추가 로드 실패:', err);
            showToast('추가 데이터를 불러오지 못했습니다.', 'error');
        } finally {
            setLoadingMore(false);
        }
    };

    const filteredLogs = logs.filter(log => {
        if (filters.vehicleId && log.vehicleId !== filters.vehicleId) return false;
        if (filters.driverUid && log.driverUid !== filters.driverUid) return false;
        // 기간 필터
        const logDate = log.date || (log.timestamp?.toDate ? toLocalDateStr(log.timestamp.toDate()) : '');
        if (filters.startDate && logDate < filters.startDate) return false;
        if (filters.endDate && logDate > filters.endDate) return false;
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">운행일지</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        {filteredLogs.length}건 · 총 {totalDistance.toLocaleString()} km
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            setDupState('scanning');
                            setDupResult(null);
                            try {
                                const result = await cleanupDuplicateLogs(orgId!, { dryRun: true });
                                setDupResult(result);
                                setDupState((result as any).deleteCount > 0 ? 'result' : 'idle');
                                if ((result as any).deleteCount === 0) {
                                    showToast('중복 데이터가 없습니다.', 'success');
                                }
                            } catch (err) {
                                console.error('중복 검사 실패:', err);
                                showToast('중복 검사에 실패했습니다.', 'error');
                                setDupState('idle');
                            }
                        }}
                        disabled={dupState === 'scanning' || dupState === 'cleaning'}
                        className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50"
                    >
                        {dupState === 'scanning' ? (
                            <span className="w-4 h-4 spinner" />
                        ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                            </svg>
                        )}
                        {dupState === 'scanning' ? '검사 중...' : '중복 검사'}
                    </button>
                    <button
                        onClick={async () => {
                            if (!filters.startDate || !filters.endDate) {
                                showToast('기간을 선택해주세요. (최대 3개월)', 'warning');
                                return;
                            }
                            const start = new Date(filters.startDate);
                            const end = new Date(filters.endDate);
                            const diffMs = end.getTime() - start.getTime();
                            if (diffMs < 0) { showToast('종료일이 시작일보다 앞섭니다.', 'warning'); return; }
                            if (diffMs > 92 * 24 * 60 * 60 * 1000) {
                                showToast('엑셀 다운로드는 최대 3개월까지 가능합니다.', 'warning');
                                return;
                            }
                            const period = `${filters.startDate}~${filters.endDate}`;
                            const { downloadDriveLogsExcel } = await import('../../lib/excelExport');
                            await downloadDriveLogsExcel(filteredLogs, `운행일지_${period}`, {
                                onError: (msg) => showToast(msg, 'warning'),
                            });
                        }}
                        disabled={filteredLogs.length === 0}
                        className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        엑셀
                    </button>
                    <button
                        onClick={async () => {
                            if (!filters.startDate || !filters.endDate) {
                                showToast('기간을 선택해주세요. (최대 3개월)', 'warning');
                                return;
                            }
                            const start = new Date(filters.startDate);
                            const end = new Date(filters.endDate);
                            const diffMs = end.getTime() - start.getTime();
                            if (diffMs < 0) { showToast('종료일이 시작일보다 앞섭니다.', 'warning'); return; }
                            if (diffMs > 92 * 24 * 60 * 60 * 1000) {
                                showToast('PDF 다운로드는 최대 3개월까지 가능합니다.', 'warning');
                                return;
                            }
                            const period = `${filters.startDate} ~ ${filters.endDate}`;
                            const { downloadDriveLogsPdf } = await import('../../lib/pdfExport');
                            const defaultApproval = [{ title: '담당' }, { title: '팀장' }];
                            const useApproval = org?.hideApprovalLine
                                ? []
                                : (org?.approvalLine?.length > 0 ? org.approvalLine : defaultApproval);
                            downloadDriveLogsPdf(filteredLogs, {
                                orgName: org?.name || '',
                                period,
                                approvalLine: useApproval,
                                onError: (msg) => showToast(msg, 'error'),
                            });
                        }}
                        disabled={filteredLogs.length === 0}
                        className="btn-primary btn-sm flex items-center gap-2 disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        PDF
                    </button>
                </div>
            </div>

            {/* 중복 탐지 결과 배너 */}
            {dupState === 'result' && dupResult && (
                <div className="glass-card p-4 mb-4 border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">⚠️</span>
                            <div>
                                <p className="font-semibold text-surface-900 dark:text-surface-100">
                                    중복 {dupResult.duplicateGroups}개 그룹, <span className="text-red-600 dark:text-red-400">{dupResult.deleteCount}건</span> 삭제 예정
                                </p>
                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                                    총 {dupResult.totalLogs}건 중 가장 먼저 생성된 1건만 남기고 나머지를 삭제합니다.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => { setDupState('idle'); setDupResult(null); }}
                                className="btn-secondary btn-sm"
                            >
                                취소
                            </button>
                            <button
                                onClick={async () => {
                                    if (!await confirm({ message: `정말 ${dupResult.deleteCount}건의 중복 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`, confirmColor: 'danger' })) return;
                                    setDupState('cleaning');
                                    try {
                                        const result = await cleanupDuplicateLogs(orgId!, { dryRun: false });
                                        showToast(`${(result as any).deleteCount}건의 중복 데이터가 삭제되었습니다.`, 'success');
                                        setDupState('idle');
                                        setDupResult(null);
                                        // 목록 새로고침
                                        setLoading(true);
                                        const [refreshed, v, m] = await Promise.all([
                                            getDriveLogs(orgId!, { limit: PAGE_SIZE }),
                                            getVehicles(orgId!),
                                            getOrganizationMembers(orgId!),
                                        ]);
                                        setLogs(refreshed.docs);
                                        setLastDoc(refreshed.lastDoc);
                                        setHasMore(refreshed.hasMore);
                                        setVehicles(v);
                                        setMembers(m.filter(x => x.role !== 'superAdmin'));
                                        setLoading(false);
                                    } catch (err) {
                                        console.error('중복 정리 실패:', err);
                                        showToast('중복 정리에 실패했습니다.', 'error');
                                        setDupState('result');
                                    }
                                }}
                                disabled={(dupState as string) === 'cleaning'}
                                className="btn-sm flex items-center gap-2 disabled:opacity-50 bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                            >
                                {(dupState as string) === 'cleaning' ? (
                                    <><span className="w-4 h-4 spinner" /> 정리 중...</>
                                ) : '정리 실행'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 필터 */}
            <div className="glass-card p-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                        type="text"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                        className="input"
                        placeholder="🔍 검색 (이름, 차량, 목적, 행선지)"
                    />
                    <select
                        value={filters.vehicleId}
                        onChange={e => setFilters({ ...filters, vehicleId: e.target.value })}
                        className="input"
                    >
                        <option value="">전체 차량</option>
                        {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.displayName}</option>
                        ))}
                    </select>
                    <select
                        value={filters.driverUid}
                        onChange={e => setFilters({ ...filters, driverUid: e.target.value })}
                        className="input"
                    >
                        <option value="">전체 직원</option>
                        {members.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.email}</option>
                        ))}
                    </select>
                </div>
                {/* 기간 필터 */}
                <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-surface-400 whitespace-nowrap">기간</span>
                    <input
                        type="date"
                        value={filters.startDate}
                        onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                        className="input text-sm flex-1"
                    />
                    <span className="text-surface-300">~</span>
                    <input
                        type="date"
                        value={filters.endDate}
                        onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                        className="input text-sm flex-1"
                    />
                    {(filters.startDate || filters.endDate) && (
                        <button
                            onClick={() => setFilters({ ...filters, startDate: '', endDate: '' })}
                            className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap"
                        >
                            초기화
                        </button>
                    )}
                </div>
            </div>

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
                    <div className="hidden sm:grid gap-2 px-4 py-2 text-xs font-medium text-surface-400" style={{ gridTemplateColumns: '80px 70px 100px 1fr 60px 60px 100px 40px 80px 40px' }}>
                        <div>날짜</div>
                        <div>운전자</div>
                        <div>차량</div>
                        <div>목적지</div>
                        <div>출발</div>
                        <div>도착</div>
                        <div>출발/도착Km</div>
                        <div className="text-center">인원</div>
                        <div className="text-right">주행거리</div>
                        <div></div>
                    </div>

                    {filteredLogs.map(log => {
                        const date = log.timestamp?.toDate
                            ? log.timestamp.toDate().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
                            : '-';
                        const distance = (log.endKm - log.startKm) || 0;

                        return (
                            <div key={log.id} className="glass-card p-4 hover:shadow-glass-lg transition-all">
                                {/* 모바일 */}
                                <div className="sm:hidden">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{log.driverName || '(이름 없음)'}</span>
                                            <span className="text-xs text-surface-400">{date}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-primary-600">{distance.toLocaleString()} km</span>
                                            <button
                                                onClick={() => handleDelete(log.id, log.driverName)}
                                                disabled={deletingId === log.id}
                                                className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                                title="삭제"
                                            >
                                                {deletingId === log.id ? (
                                                    <span className="w-4 h-4 spinner block" />
                                                ) : (
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                                        <span>{log.vehicleName}</span>
                                        <span>·</span>
                                        <span>{log.destination || '-'}</span>
                                        {(log.startTime || log.endTime) && (
                                            <span className="text-surface-400">({log.startTime || '?'} ~ {log.endTime || '?'})</span>
                                        )}
                                        {log.passengerCount > 1 && (
                                            <span className="text-primary-500">👥 {log.passengerCount}명</span>
                                        )}
                                    </div>
                                </div>

                                {/* 데스크탑 */}
                                <div className="hidden sm:grid gap-2 items-center" style={{ gridTemplateColumns: '80px 70px 100px 1fr 60px 60px 100px 40px 80px 40px' }}>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100">{date}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100 truncate">{log.driverName || '(이름 없음)'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-700 dark:text-surface-300 truncate">{log.vehicleName}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-600 dark:text-surface-400 truncate">{log.destination || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{log.startTime || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{log.endTime || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400">
                                            {log.startKm?.toLocaleString()} → {log.endKm?.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-surface-600 dark:text-surface-400">{log.passengerCount || '-'}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="font-bold text-primary-600">{distance.toLocaleString()} km</span>
                                    </div>
                                    <div className="text-center">
                                        <button
                                            onClick={() => handleDelete(log.id, log.driverName)}
                                            disabled={deletingId === log.id}
                                            className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                            title="삭제"
                                        >
                                            {deletingId === log.id ? (
                                                <span className="w-4 h-4 spinner block" />
                                            ) : (
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
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
