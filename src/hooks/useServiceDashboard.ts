import { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions } from '../lib/firebase';
import type { SortKey } from '../components/superAdmin/dashboard/dashboardUtils';
import type { OrgStat, CachedDashboardStats, CachedDashboardTimeSeries, CachedDashboardOrgRankings } from './serviceDashboard/types';
import { loadFuelHipassStats } from './serviceDashboard/loadFuelHipassStats';
import { loadNotificationStats } from './serviceDashboard/loadNotificationStats';

export default function useServiceDashboard(orgFilterId: string = 'ALL') {
    const [stats, setStats] = useState<CachedDashboardStats['monthlyStats'] extends infer _ ? {
        approvedOrgs: number; totalUsers: number; adminCount: number; employeeCount: number;
        totalLogs: number; totalDistance: number; pendingApps: number; calendarSyncOrgs: number;
        themeStats?: { dark: number; light: number; none: number };
        welcomeStats?: { dismissed: number; notDismissed: number; rate: number };
    } | null : never>(null);
    const [monthlyStats, setMonthlyStats] = useState<{
        monthLabel: string; logs: number; distance: number; activeUsers: number;
        prevLogs: number; prevDistance: number; prevActiveUsers: number;
    } | null>(null);
    const [topOrgs, setTopOrgs] = useState<OrgStat[]>([]);

    const [inputMethodStats, setInputMethodStats] = useState<{ date: string; ocr: number; manual: number }[]>([]);

    // 바로 운행 vs 사전 예약 통계
    const [quickDriveStats, setQuickDriveStats] = useState<{ date: string; regular: number; quick: number }[]>([]);
    const [quickDriveRatio, setQuickDriveRatio] = useState<{ total: number; quick: number; regular: number; rate: number }>({ total: 0, quick: 0, regular: 0, rate: 0 });

    // 추천 예약 통계
    const [recommendationStats, setRecommendationStats] = useState<{ date: string; recommendation: number; normal: number }[]>([]);
    const [recommendationRatio, setRecommendationRatio] = useState<{ total: number; recommendation: number; normal: number; rate: number }>({ total: 0, recommendation: 0, normal: 0, rate: 0 });

    // 예약 유형별(하루/다일/반복) 통계
    const [reservationTypeStats, setReservationTypeStats] = useState<{ date: string; single: number; multiDay: number; recurring: number }[]>([]);
    const [reservationTypeRatio, setReservationTypeRatio] = useState<{ total: number; single: number; multiDay: number; recurring: number; singleRate: number; multiDayRate: number; recurringRate: number }>({ total: 0, single: 0, multiDay: 0, recurring: 0, singleRate: 0, multiDayRate: 0, recurringRate: 0 });

    // 목적지 즐겨찾기 통계
    const [favoriteUserRatio, setFavoriteUserRatio] = useState<{ total: number; withFavorite: number; rate: number }>({ total: 0, withFavorite: 0, rate: 0 });
    const [favoriteLogRatio, setFavoriteLogRatio] = useState<{ total: number; favorite: number; normal: number; rate: number }>({ total: 0, favorite: 0, normal: 0, rate: 0 });
    const [favoriteStats, setFavoriteStats] = useState<{ date: string; favorite: number; normal: number }[]>([]);

    // 고도화 state
    const [_dailyDriveStats, setDailyDriveStats] = useState<{ date: string; count: number }[]>([]);
    const [dailyActiveUserStats, setDailyActiveUserStats] = useState<{ date: string; users: number }[]>([]);
    const [dailyActiveOrgStats, setDailyActiveOrgStats] = useState<{ date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[]>([]);
    const [hourlyStats, setHourlyStats] = useState<{ hour: string; count: number }[]>([]);
    const [fuelTypeStats, setFuelTypeStats] = useState<{ type: string; label: string; count: number; color: string }[]>([]);
    const [vehicleTypeStats, setVehicleTypeStats] = useState<{ type: string; label: string; count: number; color: string }[]>([]);
    const [vehicleModelStats, setVehicleModelStats] = useState<{ model: string; count: number }[]>([]);
    const [vehicleModelStatsActive, setVehicleModelStatsActive] = useState<{ model: string; count: number }[]>([]);
    const [vehicleModelStatsRetired, setVehicleModelStatsRetired] = useState<{ model: string; count: number }[]>([]);
    const [hipassRatio, setHipassRatio] = useState<{ withHipass: number; withoutHipass: number }>({ withHipass: 0, withoutHipass: 0 });
    const [calendarSyncRatio, setCalendarSyncRatio] = useState<{ sync: number; notSync: number }>({ sync: 0, notSync: 0 });
    const [calendarTopOrgs, setCalendarTopOrgs] = useState<{ name: string; count: number }[]>([]);
    const [calendarSyncOrgCount, setCalendarSyncOrgCount] = useState<number>(0);
    const [hipassTopOrgs, setHipassTopOrgs] = useState<{ name: string; count: number }[]>([]);
    const [weeklyActiveRate, setWeeklyActiveRate] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
    const [monthlyGrowth, setMonthlyGrowth] = useState<{ month: string; cumulative: number }[]>([]);

    // 히트맵 state
    const [heatmapData, setHeatmapData] = useState<{ grid: number[][]; maxCount: number }>({ grid: Array.from({ length: 7 }, () => Array(24).fill(0)), maxCount: 1 });

    // 평균 주행시간 state
    const [dailyAvgDuration, setDailyAvgDuration] = useState<{ date: string; avg: number }[]>([]);
    const [hourlyAvgDuration, setHourlyAvgDuration] = useState<{ hour: string; avg: number }[]>([]);
    const [orgAvgDuration, setOrgAvgDuration] = useState<{ name: string; avg: number }[]>([]);

    // 주유 / 하이패스 통계
    const [fuelStats, setFuelStats] = useState<{
        totalCount: number; totalCost: number;
        monthCount: number; monthCost: number; prevMonthCost: number;
    } | null>(null);
    const [hipassStats, setHipassStats] = useState<{
        totalCount: number; totalAmount: number;
        monthCount: number; monthAmount: number; prevMonthAmount: number;
    } | null>(null);
    const [dailyFuelCost, setDailyFuelCost] = useState<{ date: string; cost: number }[]>([]);
    const [dailyHipassAmount, setDailyHipassAmount] = useState<{ date: string; amount: number }[]>([]);

    // 알림 통계
    const [notifSummary, setNotifSummary] = useState<{
        total: number; read: number; unread: number; readRate: number;
    } | null>(null);
    const [dailyNotifStats, setDailyNotifStats] = useState<{ date: string; sent: number; read: number }[]>([]);
    const [notifTypeStats, setNotifTypeStats] = useState<{ type: string; count: number; color: string }[]>([]);

    // 첫 직원 등록 소요시간 통계
    const [firstEmployeeStats, setFirstEmployeeStats] = useState<{
        avg: number; median: number; sameDayRate: number; total: number;
    } | null>(null);
    const [firstEmployeeDist, setFirstEmployeeDist] = useState<{ label: string; count: number; color: string }[]>([]);
    const [firstEmployeeTrend, setFirstEmployeeTrend] = useState<{ month: string; avg: number }[]>([]);

    // 기관 규모별 분포 (캐시에서 바로 세팅, fallback용 useMemo 유지)
    const [orgSizeDistribution, setOrgSizeDistribution] = useState<{ label: string; count: number; color: string }[]>([]);

    // 온보딩 완료율
    const [onboardingStats, setOnboardingStats] = useState<{ total: number; completed: number; rate: number }>({ total: 0, completed: 0, rate: 0 });

    // 퍼널 데이터
    const [funnelData, setFunnelData] = useState<{ label: string; value: number; icon: string; color: string; gradient: string; rate: number; dropoff: number; conversionFromPrev: number }[]>([]);

    // 캐시 마지막 갱신 시각
    const [lastCacheUpdated, setLastCacheUpdated] = useState<string | null>(null);

    const [orgPage, setOrgPage] = useState(0);
    const [sortKey, setSortKey] = useState<SortKey>('logs');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [loading, setLoading] = useState(true);

    const sortedOrgs = useMemo(() => {
        const list = [...topOrgs];
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
    }, [topOrgs, sortKey, sortDir]);

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
            setStats({
                approvedOrgs: s.approvedOrgs,
                totalUsers: s.totalUsers,
                adminCount: s.adminCount,
                employeeCount: s.employeeCount,
                totalLogs: s.totalLogs,
                totalDistance: s.totalDistance,
                pendingApps: s.pendingApps,
                calendarSyncOrgs: s.calendarSyncOrgs,
                themeStats: s.themeStats,
                welcomeStats: s.welcomeStats,
            });
            setMonthlyStats(s.monthlyStats);
            setFavoriteUserRatio(s.favoriteUserRatio);
            setWeeklyActiveRate(s.weeklyActiveRate);
            setMonthlyGrowth(s.monthlyGrowth);
            setFirstEmployeeStats(s.firstEmployeeStats);
            setFirstEmployeeDist(s.firstEmployeeDist);
            setFirstEmployeeTrend(s.firstEmployeeTrend);
            setOnboardingStats(s.onboardingStats);
            setOrgSizeDistribution(s.orgSizeDistribution);
            setFuelTypeStats(s.fuelTypeStats);
            setVehicleTypeStats(s.vehicleTypeStats);
            setVehicleModelStats(s.vehicleModelStats);
            if (s.vehicleModelStatsActive) setVehicleModelStatsActive(s.vehicleModelStatsActive);
            if (s.vehicleModelStatsRetired) setVehicleModelStatsRetired(s.vehicleModelStatsRetired);
            setHipassRatio(s.hipassRatio);
            setHipassTopOrgs(s.hipassTopOrgs);
            setCalendarSyncRatio(s.calendarSyncRatio);
            setCalendarTopOrgs(s.calendarTopOrgs);
            setCalendarSyncOrgCount(s.calendarSyncOrgs);
            setLastCacheUpdated(s.lastUpdatedAt);
        }

        if (timeSeriesSnap && timeSeriesSnap.exists()) {
            const ts = timeSeriesSnap.data() as CachedDashboardTimeSeries;
            setInputMethodStats(ts.inputMethodStats);
            setDailyDriveStats(ts.dailyDriveStats);
            setDailyActiveUserStats(ts.dailyActiveUserStats);
            setDailyActiveOrgStats(ts.dailyActiveOrgStats);
            setFavoriteStats(ts.favoriteStats);
            setFavoriteLogRatio(ts.favoriteLogRatio);
            setHourlyStats(ts.hourlyStats);
            setDailyAvgDuration(ts.dailyAvgDuration);
            setHourlyAvgDuration(ts.hourlyAvgDuration);
            // items(flat) → grid(2D) 변환
            const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
            if (ts.heatmapData?.items) {
                ts.heatmapData.items.forEach(({ dayIdx, hour, count }) => { grid[dayIdx][hour] = count; });
                setHeatmapData({ grid, maxCount: ts.heatmapData.maxCount });
            }

            if (ts.quickDriveStats) setQuickDriveStats(ts.quickDriveStats);
            if (ts.quickDriveRatio) setQuickDriveRatio(ts.quickDriveRatio);
            if (ts.recommendationStats) setRecommendationStats(ts.recommendationStats);
            if (ts.recommendationRatio) setRecommendationRatio(ts.recommendationRatio);
            if (ts.reservationTypeStats) setReservationTypeStats(ts.reservationTypeStats);
            if (ts.reservationTypeRatio) setReservationTypeRatio(ts.reservationTypeRatio);
        }

        if (orgRankingsSnap && orgRankingsSnap.exists()) {
            const r = orgRankingsSnap.data() as CachedDashboardOrgRankings;
            const orgs: OrgStat[] = r.topOrgs.map(o => ({
                ...o,
                lastDriveDate: o.lastDriveDate ? new Date(o.lastDriveDate) : null,
            }));
            setTopOrgs(orgs);
            setOrgAvgDuration(r.orgAvgDuration);
            setFunnelData(r.funnelData);
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

            // 독립 통계는 기존 방식 유지 -> 서버 단 필터링이 필요할 수 있지만 프론트에서는 일단 호출
            // 서버쪽 refactoring에 orgFilterId가 반영되어야 완벽함. (loadFuelHipassStats 등은 개별 구현 확인 필요)
            await Promise.all([
                // loadFuelHipassStats, loadNotificationStats 는 추후 orgFilterId 반영 검토
                loadFuelHipassStats({
                    setFuelStats, setHipassStats, setDailyFuelCost, setDailyHipassAmount,
                }),
                loadNotificationStats({
                    setNotifSummary, setDailyNotifStats, setNotifTypeStats,
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
        stats,
        monthlyStats,
        weeklyActiveRate,
        onboardingStats,
        funnelData,
        dailyActiveOrgStats,
        dailyActiveUserStats,
        firstEmployeeStats,
        firstEmployeeDist,
        firstEmployeeTrend,
        inputMethodStats,
        quickDriveStats,
        quickDriveRatio,
        recommendationStats,
        recommendationRatio,
        reservationTypeStats,
        reservationTypeRatio,
        orgSizeDistribution,
        fuelTypeStats,
        vehicleTypeStats,
        vehicleModelStats,
        vehicleModelStatsActive,
        vehicleModelStatsRetired,
        hipassRatio,
        calendarSyncRatio,
        calendarTopOrgs,
        calendarSyncOrgCount,
        hipassTopOrgs,
        fuelStats,
        hipassStats,
        dailyFuelCost,
        dailyHipassAmount,
        heatmapData,
        hourlyStats,
        monthlyGrowth,
        dailyAvgDuration,
        hourlyAvgDuration,
        orgAvgDuration,
        notifSummary,
        dailyNotifStats,
        notifTypeStats,
        topOrgs,
        sortedOrgs,
        favoriteUserRatio,
        favoriteLogRatio,
        favoriteStats,
        orgPage,
        setOrgPage,
        sortKey,
        sortDir,
        handleSort,
        sortIndicator,
        loadAllStats,
        refreshServerStats,
        lastCacheUpdated,
    };
}
