/**
 * useDriveLogList — 운행일지 목록 데이터 fetching, 페이지네이션, 중복 검사, 내보내기 핸들러
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { getDriveLogs, getVehicles, getOrganizationMembers, getOrganization, cleanupDuplicateLogs, deleteDriveLog } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import { matchesSearch } from './driveLogList/matchesSearch';
import { useDriveLogExport } from './driveLogList/useDriveLogExport';
import type { DocumentSnapshot } from 'firebase/firestore';
import type { DriveLog } from '../types/driveLog';
import type { Vehicle } from '../types/vehicle';
import type { User } from '../types/user';
import type { Organization } from '../types/organization';

interface DupResult {
    deleteCount: number;
    duplicateGroups: number;
    totalLogs: number;
    /** 서버가 실제로 훑은 범위(개월). 전량이 아니므로 화면이 밝혀야 한다. */
    scanMonths: number;
}

const PAGE_SIZE = 50;

export default function useDriveLogList() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [org, setOrg] = useState<Organization | null>(null);
    const [dupState, setDupState] = useState<'idle' | 'scanning' | 'result' | 'cleaning'>('idle');
    const [dupResult, setDupResult] = useState<DupResult | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const now = new Date();
    const firstDay = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastDay = toLocalDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    // 필터는 **주소에 담는다**(?vehicle=&driver=&q=&from=&to=). 화면 안에만 두면 일지를 고치러 나갔다
    // 돌아올 때마다 이번 달·전체 차량으로 초기화돼, 같은 차량·기간의 다른 직원 일지를 이어서 고치려면
    // 차량과 기간을 매번 다시 골라야 했다(2026-10-16 운영 의견). 주소에 있으면 수정 후 복귀
    // (DriveLogTableRow의 returnTo)·뒤로 가기·새로고침에서 그대로 남는다. 기본값은 주소에 적지 않는다.
    const [searchParams, setSearchParams] = useSearchParams();
    const [filters, setFilters] = useState(() => {
        const dateOr = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
        return {
            vehicleId: searchParams.get('vehicle') ?? '',
            driverUid: searchParams.get('driver') ?? '',
            search: searchParams.get('q') ?? '',
            startDate: dateOr(searchParams.get('from'), firstDay),
            endDate: dateOr(searchParams.get('to'), lastDay),
        };
    });

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        const put = (key: string, value: string, fallback = '') => {
            if (value && value !== fallback) next.set(key, value); else next.delete(key);
        };
        put('vehicle', filters.vehicleId);
        put('driver', filters.driverUid);
        put('q', filters.search);
        put('from', filters.startDate, firstDay);
        put('to', filters.endDate, lastDay);
        if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
        // searchParams를 의존성에 넣으면 주소를 바꿀 때마다 다시 돈다 — 필터가 바뀔 때만 주소를 맞춘다
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.vehicleId, filters.driverUid, filters.search, filters.startDate, filters.endDate]);

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
                setLogs(result.docs);
                setLastDoc(result.lastDoc as DocumentSnapshot | null);
                setHasMore(result.hasMore);
                setVehicles(v);
                setMembers(m.filter(x => x.role !== 'superAdmin'));
                setOrg(orgData);
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
            setLogs(prev => [...prev, ...result.docs]);
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

    // 검색 필터링 — logs/filters.search가 동일하면 재계산 생략
    const filteredLogs = useMemo(() => {
        if (!filters.search) return logs;
        return logs.filter(log => matchesSearch(log, filters.search));
    }, [logs, filters.search]);

    const totalDistance = useMemo(
        () => filteredLogs.reduce((sum, l) => sum + ((l.endKm - l.startKm) || 0), 0),
        [filteredLogs]
    );

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
                // 검사 범위를 함께 알린다 — "없습니다"만 띄우면 전량 무결로 오해한다
                showToast(`최근 ${(result as DupResult).scanMonths}개월 기록에는 중복 데이터가 없습니다.`, 'success');
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
            setLogs(refreshed.docs);
            setLastDoc(refreshed.lastDoc as DocumentSnapshot | null);
            setHasMore(refreshed.hasMore);
            setVehicles(v);
            setMembers(m.filter(x => x.role !== 'superAdmin'));
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

    // 내보내기(엑셀/PDF)는 목록 상태와 독립적이므로 별도 훅으로 분리
    const {
        includeHipass, setIncludeHipass,
        includePassengers, setIncludePassengers,
        includeFuel, setIncludeFuel,
        handleExportExcel, handleExportPdf,
    } = useDriveLogExport(orgId, filters, org);

    return {
        // 상태
        logs, vehicles, members, loading, loadingMore, hasMore,
        filters, setFilters, filteredLogs, totalDistance,
        deletingId, includeHipass, setIncludeHipass, includePassengers, setIncludePassengers,
        includeFuel, setIncludeFuel,
        dupState, dupResult,
        // 핸들러
        loadMore, handleDelete,
        handleDupScan, handleDupClean, handleDupCancel,
        handleExportExcel, handleExportPdf,
    };
}
