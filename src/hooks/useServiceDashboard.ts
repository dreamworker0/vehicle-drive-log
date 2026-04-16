import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SortKey, ServiceStats } from '../components/superAdmin/dashboard/dashboardUtils';
import type { OrgStat, SharedSnaps } from './serviceDashboard/types';
import { processServiceStats } from './serviceDashboard/processServiceStats';
import { processMonthlyStats } from './serviceDashboard/processMonthlyStats';
import { processTopOrganizations } from './serviceDashboard/processTopOrganizations';
import { loadFuelHipassStats } from './serviceDashboard/loadFuelHipassStats';
import { loadNotificationStats } from './serviceDashboard/loadNotificationStats';
import { loadQuickDriveStats } from './serviceDashboard/loadQuickDriveStats';

export default function useServiceDashboard() {
    const [stats, setStats] = useState<ServiceStats | null>(null);
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
    const [hipassRatio, setHipassRatio] = useState<{ withHipass: number; withoutHipass: number }>({ withHipass: 0, withoutHipass: 0 });
    const [calendarSyncRatio, setCalendarSyncRatio] = useState<{ sync: number; notSync: number }>({ sync: 0, notSync: 0 });
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


    // 기관 규모별 분포
    const orgSizeDistribution = useMemo(() => {
        let small = 0, medium = 0, large = 0;
        topOrgs.forEach(org => {
            if (org.users <= 2) small++;
            else if (org.users <= 10) medium++;
            else large++;
        });
        return [
            { label: '소규모 (1~2명)', count: small, color: '#60a5fa' },
            { label: '중규모 (3~10명)', count: medium, color: '#34d399' },
            { label: '대규모 (11명 이상)', count: large, color: '#f59e0b' },
        ];
    }, [topOrgs]);

    // 온보딩 완료율 (차량+사용자+운행 모두 있는 기관)
    const onboardingStats = useMemo(() => {
        const total = topOrgs.length;
        if (total === 0) return { total: 0, completed: 0, rate: 0 };
        const completed = topOrgs.filter(org => org.users > 0 && org.vehicles > 0 && org.logs > 0).length;
        return { total, completed, rate: Math.round((completed / total) * 100) };
    }, [topOrgs]);

    // 기관 활성화 퍼널 데이터
    const funnelData = useMemo(() => {
        const totalOrgs = topOrgs.length;
        if (totalOrgs === 0) return [];
        const activeOrgs = topOrgs.filter(org => org.users > 0).length;
        const vehicleOrgs = topOrgs.filter(org => org.vehicles > 0).length;
        const drivingOrgs = topOrgs.filter(org => org.logs > 0).length;

        const steps = [
            { label: '신청 기관', value: totalOrgs, icon: '📋', color: '#3b82f6', gradient: 'from-blue-500 to-blue-600' },
            { label: '활성 기관 (직원 등록)', value: activeOrgs, icon: '👥', color: '#8b5cf6', gradient: 'from-violet-500 to-violet-600' },
            { label: '차량 등록', value: vehicleOrgs, icon: '🚗', color: '#f59e0b', gradient: 'from-amber-500 to-amber-600' },
            { label: '주행 실행', value: drivingOrgs, icon: '🛣️', color: '#22c55e', gradient: 'from-emerald-500 to-emerald-600' },
        ];

        return steps.map((step, idx) => ({
            ...step,
            rate: Math.round((step.value / totalOrgs) * 100),
            dropoff: idx > 0 ? steps[idx - 1].value - step.value : 0,
            conversionFromPrev: idx > 0 && steps[idx - 1].value > 0
                ? Math.round((step.value / steps[idx - 1].value) * 100)
                : 100,
        }));
    }, [topOrgs]);

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

    useEffect(() => {
        const cachedTime = sessionStorage.getItem('svc_dashboard_cache_time');
        const now = Date.now();

        // 5분 내 재진입 시 로딩 애니메이션 생략 (UI 블로킹 방지)
        const isBackground = cachedTime && (now - parseInt(cachedTime) < 5 * 60 * 1000);
        if (isBackground) {
            setLoading(false);
        }

        loadAllStats(!!isBackground);
    }, []);

    const loadAllStats = async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            // 공유 컬렉션을 1회만 조회
            const [orgSnap, userSnap, logSnap, vehicleSnap, hipassCardSnap, favoriteSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'driveLogs')),
                getDocs(collection(db, 'vehicles')),
                getDocs(collection(db, 'hipassCards')),
                getDocs(collection(db, 'favorites')),
            ]);
            const shared: SharedSnaps = { orgSnap, userSnap, logSnap, vehicleSnap, hipassCardSnap, favoriteSnap };

            // 공유 데이터로 통계 계산 + 독립 컬렉션은 개별 로드
            await Promise.all([
                processServiceStats(shared, {
                    setStats, setFavoriteUserRatio, setInputMethodStats, setDailyDriveStats,
                    setDailyActiveUserStats, setDailyActiveOrgStats, setHourlyStats,
                    setWeeklyActiveRate, setFavoriteStats, setFavoriteLogRatio,
                    setHeatmapData, setDailyAvgDuration, setHourlyAvgDuration,
                }),
                processMonthlyStats(shared, { setMonthlyStats }),
                processTopOrganizations(shared, {
                    setTopOrgs, setStats, setHipassRatio, setCalendarSyncRatio,
                    setHipassTopOrgs, setFuelTypeStats, setVehicleTypeStats,
                    setVehicleModelStats, setOrgAvgDuration, setMonthlyGrowth,
                    setFirstEmployeeStats, setFirstEmployeeDist, setFirstEmployeeTrend,
                }),
                loadFuelHipassStats({
                    setFuelStats, setHipassStats, setDailyFuelCost, setDailyHipassAmount,
                }),
                loadNotificationStats({
                    setNotifSummary, setDailyNotifStats, setNotifTypeStats,
                }),
                loadQuickDriveStats({
                    setQuickDriveStats, setQuickDriveRatio, setRecommendationStats, setRecommendationRatio,
                }),
            ]);

            sessionStorage.setItem('svc_dashboard_cache_time', Date.now().toString());
        } finally {
            if (!isBackground) setLoading(false);
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
        orgSizeDistribution,
        fuelTypeStats,
        vehicleTypeStats,
        vehicleModelStats,
        hipassRatio,
        calendarSyncRatio,
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
    };
}
