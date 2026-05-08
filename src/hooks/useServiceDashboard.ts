/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions } from '../lib/firebase';
import type { SortKey } from '../components/superAdmin/dashboard/dashboardUtils';
import type { OrgStat, CachedDashboardStats, CachedDashboardTimeSeries, CachedDashboardOrgRankings } from './serviceDashboard/types';
import { loadFuelHipassStats } from './serviceDashboard/loadFuelHipassStats';
import { loadNotificationStats } from './serviceDashboard/loadNotificationStats';

/** 
 * 도메인별 통계 상태를 그룹화하기 위한 기본 타입
 */
export type DashboardSummaryState = Partial<CachedDashboardStats> & {
    stats?: {
        approvedOrgs: number;
        totalUsers: number;
        adminCount: number;
        employeeCount: number;
        totalLogs: number;
        totalDistance: number;
        pendingApps: number;
        calendarSyncOrgs: number;
        themeStats?: { dark: number; light: number; none: number };
        welcomeStats?: { dismissed: number; notDismissed: number; rate: number };
    };
};
export type DashboardTimeSeriesState = Omit<Partial<CachedDashboardTimeSeries>, 'heatmapData'> & {
    heatmapData?: { grid: number[][]; maxCount: number };
};
export type DashboardRankingsState = Omit<Partial<CachedDashboardOrgRankings>, 'topOrgs'> & {
    topOrgs: OrgStat[];
};
export type DashboardExternalState = {
    fuelStats: any | null; hipassStats: any | null; dailyFuelCost: any[]; dailyHipassAmount: any[];
    notifSummary: any | null; dailyNotifStats: any[]; notifTypeStats: any[];
};

export default function useServiceDashboard(orgFilterId: string = 'ALL') {
    // 1. 요약 통계 그룹 (CachedDashboardStats)
    const [summary, setSummary] = useState<DashboardSummaryState>({});

    // 2. 시계열 통계 그룹 (CachedDashboardTimeSeries)
    const [timeSeries, setTimeSeries] = useState<DashboardTimeSeriesState>({
        heatmapData: { grid: Array.from({ length: 7 }, () => Array(24).fill(0)), maxCount: 1 }
    });

    // 3. 랭킹 통계 그룹 (CachedDashboardOrgRankings)
    const [rankings, setRankings] = useState<DashboardRankingsState>({ topOrgs: [] });

    // 4. 외부 비동기 로드 통계 그룹 (주유/하이패스, 알림)
    const [external, setExternal] = useState<DashboardExternalState>({
        fuelStats: null, hipassStats: null, dailyFuelCost: [], dailyHipassAmount: [],
        notifSummary: null, dailyNotifStats: [], notifTypeStats: []
    });

    // 5. UI 및 제어 상태
    const [orgPage, setOrgPage] = useState(0);
    const [sortKey, setSortKey] = useState<SortKey>('logs');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [loading, setLoading] = useState(true);

    const sortedOrgs = useMemo(() => {
        const list = [...rankings.topOrgs];
        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a: OrgStat, b: OrgStat) => {
            if (sortKey === 'name') {
                return dir * (a.name || '').localeCompare(b.name || '', 'ko');
            }
            if (sortKey === 'lastDriveDate') {
                const ta = a.lastDriveDate ? a.lastDriveDate.getTime() : 0;
                const tb = b.lastDriveDate ? b.lastDriveDate.getTime() : 0;
                return dir * (ta - tb);
            }
            return dir * ((a[sortKey] as number || 0) - (b[sortKey] as number || 0));
        });
        return list;
    }, [rankings.topOrgs, sortKey, sortDir]);

    const handleSort = useCallback((key: SortKey) => {
        setSortKey(prev => {
            if (prev === key) {
                setSortDir(d => d === 'asc' ? 'desc' : 'asc');
            } else {
                setSortDir('desc');
            }
            return key;
        });
        setOrgPage(0);
    }, []);

    const sortIndicator = (key: SortKey) => {
        if (sortKey !== key) return null;
        return sortDir === 'asc' ? '▲' : '▼';
    };

    // ── 캐시 문서 데이터를 state에 반영하는 헬퍼 ──
    const applyCacheDocuments = useCallback((
        statsSnap: Awaited<ReturnType<typeof getDoc>>,
        timeSeriesSnap: Awaited<ReturnType<typeof getDoc>>,
        orgRankingsSnap: Awaited<ReturnType<typeof getDoc>> | null,
    ) => {
        if (statsSnap && statsSnap.exists()) {
            const s = statsSnap.data() as CachedDashboardStats;
            setSummary({
                stats: {
                    approvedOrgs: s.approvedOrgs, totalUsers: s.totalUsers, adminCount: s.adminCount,
                    employeeCount: s.employeeCount, totalLogs: s.totalLogs, totalDistance: s.totalDistance,
                    pendingApps: s.pendingApps, calendarSyncOrgs: s.calendarSyncOrgs,
                    themeStats: s.themeStats, welcomeStats: s.welcomeStats,
                },
                ...s
            });
        }

        if (timeSeriesSnap && timeSeriesSnap.exists()) {
            const ts = timeSeriesSnap.data() as CachedDashboardTimeSeries;
            
            // heatmapData 변환 (items(flat) → grid(2D))
            const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
            if (ts.heatmapData?.items) {
                ts.heatmapData.items.forEach(({ dayIdx, hour, count }) => { grid[dayIdx][hour] = count; });
            }

            setTimeSeries({
                ...ts,
                heatmapData: { grid, maxCount: ts.heatmapData?.maxCount || 1 }
            });
        }

        if (orgRankingsSnap && orgRankingsSnap.exists()) {
            const r = orgRankingsSnap.data() as CachedDashboardOrgRankings;
            const orgs: OrgStat[] = (r.topOrgs || []).map(o => ({
                ...o,
                lastDriveDate: o.lastDriveDate ? new Date(o.lastDriveDate) : null,
            }));
            setRankings({
                ...r,
                topOrgs: orgs,
            });
        }
    }, []);

    const loadAllStats = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const isAll = orgFilterId === 'ALL';
            const statsDocName = isAll ? 'dashboardStats' : `dashboardStats_${orgFilterId}`;
            const timeSeriesDocName = isAll ? 'dashboardTimeSeries' : `dashboardTimeSeries_${orgFilterId}`;
            const orgRankingsDocName = 'dashboardOrgRankings';

            // 캐시 문서 3건 + 독립 통계 3건 병렬 로드
            const [statsDoc, timeSeriesDoc, orgRankingsDoc] = await Promise.all([
                getDoc(doc(db, 'system', statsDocName)),
                getDoc(doc(db, 'system', timeSeriesDocName)),
                getDoc(doc(db, 'system', orgRankingsDocName)),
            ]);

            // ── 캐시 문서가 하나도 없으면 자동으로 초기 시딩 수행 (ALL인 경우만) ──
            const noneExists = !statsDoc.exists() && !timeSeriesDoc.exists() && (orgRankingsDoc ? !orgRankingsDoc.exists() : true);
            if (noneExists && isAll) {
                console.info('[Dashboard] 캐시 문서가 없습니다. 자동으로 초기 통계를 생성합니다...');
                try {
                    const refreshFn = httpsCallable(firebaseFunctions, 'refreshDashboardStats');
                    await refreshFn();
                    // 캐시 생성 후 다시 로드
                    const [s2, ts2, r2] = await Promise.all([
                        getDoc(doc(db, 'system', statsDocName)),
                        getDoc(doc(db, 'system', timeSeriesDocName)),
                        getDoc(doc(db, 'system', orgRankingsDocName)),
                    ]);
                    applyCacheDocuments(s2, ts2, r2);
                    console.info('[Dashboard] 초기 시딩 완료');
                } catch (seedErr) {
                    console.error('[Dashboard] 자동 초기 시딩 실패:', seedErr);
                }
            } else {
                // ── 캐시 문서별 개별 처리 (일부만 있어도 해당 데이터는 표시) ──
                applyCacheDocuments(statsDoc, timeSeriesDoc, orgRankingsDoc);
            }

            // 외부 독립 통계는 개별 setter 래퍼를 통해 external state로 병합
            await Promise.all([
                loadFuelHipassStats({
                    setFuelStats: (val) => setExternal(prev => ({ ...prev, fuelStats: typeof val === 'function' ? val(prev.fuelStats) : val })),
                    setHipassStats: (val) => setExternal(prev => ({ ...prev, hipassStats: typeof val === 'function' ? val(prev.hipassStats) : val })),
                    setDailyFuelCost: (val) => setExternal(prev => ({ ...prev, dailyFuelCost: typeof val === 'function' ? val(prev.dailyFuelCost) : val })),
                    setDailyHipassAmount: (val) => setExternal(prev => ({ ...prev, dailyHipassAmount: typeof val === 'function' ? val(prev.dailyHipassAmount) : val })),
                }),
                loadNotificationStats({
                    setNotifSummary: (val) => setExternal(prev => ({ ...prev, notifSummary: typeof val === 'function' ? val(prev.notifSummary) : val })),
                    setDailyNotifStats: (val) => setExternal(prev => ({ ...prev, dailyNotifStats: typeof val === 'function' ? val(prev.dailyNotifStats) : val })),
                    setNotifTypeStats: (val) => setExternal(prev => ({ ...prev, notifTypeStats: typeof val === 'function' ? val(prev.notifTypeStats) : val })),
                }),
            ]);

            sessionStorage.setItem(`svc_dashboard_cache_time_${orgFilterId}`, Date.now().toString());
        } finally {
            if (!isBackground) setLoading(false);
        }
    }, [applyCacheDocuments, orgFilterId]);

    useEffect(() => {
        const cachedTime = sessionStorage.getItem('svc_dashboard_cache_time');
        const now = Date.now();

        // 5분 내 재진입 시 로딩 애니메이션 생략 (UI 블로킹 방지)
        const isBackground = cachedTime && (now - parseInt(cachedTime) < 5 * 60 * 1000);
        if (isBackground) {
            setLoading(false);
        }

        loadAllStats(!!isBackground);
    }, [loadAllStats]);

    /**
     * 서버 측 대시보드 통계 재계산 요청 (Cloud Function 호출)
     */
    const refreshServerStats = async () => {
        setLoading(true);
        try {
            const refreshFn = httpsCallable(firebaseFunctions, 'refreshDashboardStats');
            await refreshFn();
            // 재집계 완료 후 데이터 다시 로드
            await loadAllStats(false);
        } catch (err) {
            console.error('[Dashboard] 서버 갱신 실패:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        loading,
        summary,
        timeSeries,
        rankings,
        external,
        sortedOrgs,
        ui: {
            orgPage, setOrgPage, sortKey, sortDir, handleSort, sortIndicator
        },
        actions: {
            loadAllStats, refreshServerStats
        }
    };
}

