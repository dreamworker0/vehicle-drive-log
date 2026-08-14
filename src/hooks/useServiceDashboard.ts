 
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, firebaseFunctions } from '../lib/firebase';
import { refreshToken } from '../lib/tokenRefresh';
import { mapNotifTypeCounts, type SortKey, type FuelStatsData, type HipassStatsData, type NotifSummaryData } from '../components/superAdmin/dashboard/dashboardUtils';
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
    lastUpdatedAt?: string;
};
export type DashboardTimeSeriesState = Omit<Partial<CachedDashboardTimeSeries>, 'heatmapData'> & {
    heatmapData?: { grid: number[][]; maxCount: number };
};
export type DashboardRankingsState = Omit<Partial<CachedDashboardOrgRankings>, 'topOrgs'> & {
    topOrgs: OrgStat[];
};
export type DashboardExternalState = {
    fuelStats: FuelStatsData | null;
    hipassStats: HipassStatsData | null;
    dailyFuelCost: { date: string; cost: number }[];
    dailyHipassAmount: { date: string; amount: number }[];
    notifSummary: NotifSummaryData | null;
    dailyNotifStats: { date: string; sent: number; read: number }[];
    notifTypeStats: { type: string; count: number; color: string }[];
};

/** Firestore 권한 거부(Rules 거부 또는 토큰에 Claims 미반영)인지 판별한다. */
function isPermissionDenied(err: unknown): boolean {
    const e = err as { code?: unknown; message?: unknown } | null;
    if (!e) return false;
    if (typeof e.code === 'string' && e.code.endsWith('permission-denied')) return true;
    return typeof e.message === 'string' && e.message.includes('Missing or insufficient permissions');
}

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/**
 * system/* 캐시 문서를 읽는다. 권한 거부면 토큰을 갱신해 다시 읽는다.
 *
 * `system/*` Rules는 `request.auth.token.role == 'superAdmin'`(Custom Claims)을 본다.
 * 그런데 라우팅 가드(AuthGuard)는 **Firestore 사용자 문서의 role**로 통과시키므로,
 * 캐시된 토큰에 Claims가 아직 실리지 않은 세션에서는 대시보드가 먼저 마운트되고
 * 이 읽기가 permission-denied로 떨어진다(useAuth의 초기 토큰 갱신은 로딩을 막지 않는다).
 *
 * onSnapshot 구독은 useAuth의 에러 핸들러가 갱신·재시도로 자동 복구하지만, 이 화면의
 * 단발성 getDoc에는 그 경로가 없어 **차트가 통째로 "데이터 없음"으로 굳어 있었다**
 * (전역 unhandledrejection 억제가 콘솔 경고 한 줄로 삼켜 원인도 보이지 않았다).
 * 기다려서 나아지는 문제가 아니라 토큰이 바뀌어야 하는 문제이므로, 백오프가 아니라
 * 갱신을 처방한다 — callableRetry의 `unauthenticated` 경로와 같은 규약
 * (.agent/rules/token-auth-resilience.md §2).
 */
async function readSystemDocs(names: string[], attempts = 3) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await Promise.all(names.map(name => getDoc(doc(db, 'system', name))));
        } catch (err) {
            lastError = err;
            if (attempt >= attempts || !isPermissionDenied(err) || !auth.currentUser) break;
            console.debug(`[Dashboard] 캐시 문서 권한 거부 — 토큰 갱신 후 재시도 (${attempt}/${attempts - 1})`);
            // 갱신 실패(네트워크 등)도 삼키고 재시도한다 — 다음 시도가 같은 거부로 떨어지면
            // 그때 호출부가 오류 안내를 띄운다. 무한 루프에 빠뜨리지 않는다(규칙 §5).
            await refreshToken(auth.currentUser).catch(() => {});
            await delay(500 * attempt);
        }
    }
    throw lastError;
}

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

    /**
     * 캐시 문서 로드 실패 사유. null이면 정상.
     * 실패를 빈 데이터로 두면 "집계 결과가 0건"과 구분되지 않아, 권한·네트워크 문제가
     * 텅 빈 차트로 위장된다 — 화면이 원인을 말하고 재시도를 제공하도록 상태로 남긴다.
     */
    const [loadError, setLoadError] = useState<'permission' | 'unknown' | null>(null);

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
        setLoadError(null);
        try {
            const isAll = orgFilterId === 'ALL';
            const statsDocName = isAll ? 'dashboardStats' : `dashboardStats_${orgFilterId}`;
            const timeSeriesDocName = isAll ? 'dashboardTimeSeries' : `dashboardTimeSeries_${orgFilterId}`;
            const orgRankingsDocName = 'dashboardOrgRankings';

            // 캐시 문서 3건 병렬 로드 (권한 거부 시 토큰 갱신 후 재시도)
            let [statsSnap, timeSeriesSnap, orgRankingsSnap] = await readSystemDocs([
                statsDocName, timeSeriesDocName, orgRankingsDocName,
            ]);

            // ── 캐시 문서가 하나도 없으면 자동으로 초기 시딩 수행 (ALL인 경우만) ──
            const noneExists = !statsSnap.exists() && !timeSeriesSnap.exists() && (orgRankingsSnap ? !orgRankingsSnap.exists() : true);
            if (noneExists && isAll) {
                console.info('[Dashboard] 캐시 문서가 없습니다. 자동으로 초기 통계를 생성합니다...');
                try {
                    const refreshFn = httpsCallable(firebaseFunctions, 'refreshDashboardStats');
                    await refreshFn();
                    // 캐시 생성 후 다시 로드
                    [statsSnap, timeSeriesSnap, orgRankingsSnap] = await readSystemDocs([
                        statsDocName, timeSeriesDocName, orgRankingsDocName,
                    ]);
                    console.info('[Dashboard] 초기 시딩 완료');
                } catch (seedErr) {
                    console.error('[Dashboard] 자동 초기 시딩 실패:', seedErr);
                }
            }

            // ── 캐시 문서별 개별 처리 (일부만 있어도 해당 데이터는 표시) ──
            applyCacheDocuments(statsSnap, timeSeriesSnap, orgRankingsSnap);

            // ── 주유/하이패스/알림: ALL 스코프는 사전집계 캐시 우선, 아니면(기관 필터·구캐시) 라이브 로더 폴백 ──
            const s = statsSnap.exists() ? statsSnap.data() as CachedDashboardStats : null;
            const ts = timeSeriesSnap.exists() ? timeSeriesSnap.data() as CachedDashboardTimeSeries : null;
            const fuelFromCache = isAll && !!s?.fuelStats && !!s?.hipassStats && !!ts?.dailyFuelCost && !!ts?.dailyHipassAmount;
            const notifFromCache = isAll && !!s?.notifSummary && !!ts?.dailyNotifStats && !!ts?.notifTypeCounts;

            if (fuelFromCache) {
                setExternal(prev => ({
                    ...prev,
                    fuelStats: s!.fuelStats!, hipassStats: s!.hipassStats!,
                    dailyFuelCost: ts!.dailyFuelCost!, dailyHipassAmount: ts!.dailyHipassAmount!,
                }));
            }
            if (notifFromCache) {
                setExternal(prev => ({
                    ...prev,
                    notifSummary: s!.notifSummary!, dailyNotifStats: ts!.dailyNotifStats!,
                    notifTypeStats: mapNotifTypeCounts(ts!.notifTypeCounts!),
                }));
            }

            // 외부 독립 통계는 개별 setter 래퍼를 통해 external state로 병합
            const liveLoaders: Promise<void>[] = [];
            if (!fuelFromCache) {
                liveLoaders.push(loadFuelHipassStats({
                    setFuelStats: (val) => setExternal(prev => ({ ...prev, fuelStats: typeof val === 'function' ? val(prev.fuelStats) : val })),
                    setHipassStats: (val) => setExternal(prev => ({ ...prev, hipassStats: typeof val === 'function' ? val(prev.hipassStats) : val })),
                    setDailyFuelCost: (val) => setExternal(prev => ({ ...prev, dailyFuelCost: typeof val === 'function' ? val(prev.dailyFuelCost) : val })),
                    setDailyHipassAmount: (val) => setExternal(prev => ({ ...prev, dailyHipassAmount: typeof val === 'function' ? val(prev.dailyHipassAmount) : val })),
                }, orgFilterId));
            }
            if (!notifFromCache) {
                liveLoaders.push(loadNotificationStats({
                    setNotifSummary: (val) => setExternal(prev => ({ ...prev, notifSummary: typeof val === 'function' ? val(prev.notifSummary) : val })),
                    setDailyNotifStats: (val) => setExternal(prev => ({ ...prev, dailyNotifStats: typeof val === 'function' ? val(prev.dailyNotifStats) : val })),
                    setNotifTypeStats: (val) => setExternal(prev => ({ ...prev, notifTypeStats: typeof val === 'function' ? val(prev.notifTypeStats) : val })),
                }, orgFilterId));
            }
            if (liveLoaders.length > 0) await Promise.all(liveLoaders);

            sessionStorage.setItem(`svc_dashboard_cache_time_${orgFilterId}`, Date.now().toString());
        } catch (err) {
            // 여기까지 온 실패는 캐시 문서 읽기가 토큰 갱신 재시도까지 소진한 경우다.
            // 던지지 않는다 — 호출부(useEffect)가 받지 못해 전역 unhandledrejection으로
            // 흘러가면 다시 조용히 삼켜진다. 상태로 남겨 화면이 안내·재시도를 띄운다.
            const denied = isPermissionDenied(err);
            setLoadError(denied ? 'permission' : 'unknown');
            console.error('[Dashboard] 통계 캐시 로드 실패:', err);
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

    // 재집계 요청 진행 중 여부 — 스피너 전환 전(같은 프레임) 연타로 요청이 중복 발사되는 것을 막는다.
    const refreshingRef = useRef(false);

    /**
     * 서버 측 대시보드 통계 재계산 요청 (Cloud Function 호출).
     * 반환: { skipped } — 서버 쿨다운으로 재집계가 생략됐는지 여부. retryAfterSec는 남은 대기(초).
     */
    const refreshServerStats = async (): Promise<{ skipped: boolean; retryAfterSec?: number }> => {
        // 클라이언트 재진입 가드: 이미 요청이 진행 중이면 무시 (중복 발사 차단)
        if (refreshingRef.current) return { skipped: true };
        refreshingRef.current = true;
        setLoading(true);
        try {
            const refreshFn = httpsCallable<unknown, { success: boolean; skipped?: boolean; retryAfterSec?: number }>(
                firebaseFunctions, 'refreshDashboardStats'
            );
            const { data } = await refreshFn();
            const skipped = data?.skipped === true;
            // 쿨다운으로 생략된 경우 캐시는 그대로이므로 재로드 없이 반환 (불필요한 read 절약)
            if (!skipped) await loadAllStats(false);
            return { skipped, retryAfterSec: data?.retryAfterSec };
        } catch (err) {
            console.error('[Dashboard] 서버 갱신 실패:', err);
            throw err;
        } finally {
            setLoading(false);
            refreshingRef.current = false;
        }
    };

    return {
        loading,
        loadError,
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

