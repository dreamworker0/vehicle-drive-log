import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import HeatmapGrid from '../common/HeatmapGrid';

const FUEL_LABELS: Record<string, string> = { gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기차' };
const FUEL_COLORS: Record<string, string> = { gasoline: '#f59e0b', diesel: '#6366f1', lpg: '#14b8a6', electric: '#3b82f6' };

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리 + 고도화 인사이트
 */
export default function ServiceDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [monthlyStats, setMonthlyStats] = useState<any>(null);
    const [topOrgs, setTopOrgs] = useState<any[]>([]);
    const [recentApprovals, setRecentApprovals] = useState<any[]>([]);
    const [inputMethodStats, setInputMethodStats] = useState<{ date: string; ocr: number; manual: number }[]>([]);

    // 고도화 state
    const [dailyDriveStats, setDailyDriveStats] = useState<{ date: string; count: number }[]>([]);
    const [hourlyStats, setHourlyStats] = useState<{ hour: string; count: number }[]>([]);
    const [vehicleTypeStats, setVehicleTypeStats] = useState<{ type: string; label: string; count: number; color: string }[]>([]);
    const [weeklyActiveRate, setWeeklyActiveRate] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
    const [monthlyGrowth, setMonthlyGrowth] = useState<{ month: string; cumulative: number }[]>([]);

    // 히트맵 state
    const [heatmapData, setHeatmapData] = useState<{ grid: number[][]; maxCount: number }>({ grid: Array.from({ length: 7 }, () => Array(24).fill(0)), maxCount: 1 });

    // 평균 주행시간 state
    const [dailyAvgDuration, setDailyAvgDuration] = useState<{ date: string; avg: number }[]>([]);
    const [hourlyAvgDuration, setHourlyAvgDuration] = useState<{ hour: string; avg: number }[]>([]);
    const [orgAvgDuration, setOrgAvgDuration] = useState<{ name: string; avg: number }[]>([]);

    // 신규 승인 기관을 날짜별 갯수로 집계 (최근 30일)
    const approvalChartData = useMemo(() => {
        if (recentApprovals.length === 0) return [];
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        const dateMap: Record<string, number> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            dateMap[key] = 0;
        }
        recentApprovals.forEach(org => {
            const d = org.approvedAt;
            if (d < thirtyDaysAgo) return;
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            if (key in dateMap) dateMap[key]++;
        });
        return Object.entries(dateMap).map(([date, count]) => ({ date, count }));
    }, [recentApprovals]);

    // 비활성 기관 (최근 30일 운행 0건)
    const inactiveOrgs = useMemo(() => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return topOrgs.filter(org => org.users > 0 && (!org.lastDriveDate || org.lastDriveDate < thirtyDaysAgo));
    }, [topOrgs]);

    // 기관 규모별 분포
    const orgSizeDistribution = useMemo(() => {
        let small = 0, medium = 0, large = 0;
        topOrgs.forEach(org => {
            if (org.users <= 3) small++;
            else if (org.users <= 10) medium++;
            else large++;
        });
        return [
            { label: '소규모 (1~3명)', count: small, color: '#60a5fa' },
            { label: '중규모 (4~10명)', count: medium, color: '#34d399' },
            { label: '대규모 (11명+)', count: large, color: '#f59e0b' },
        ];
    }, [topOrgs]);

    // 온보딩 완료율 (차량+사용자+운행 모두 있는 기관)
    const onboardingStats = useMemo(() => {
        const total = topOrgs.length;
        if (total === 0) return { total: 0, completed: 0, rate: 0 };
        const completed = topOrgs.filter(org => org.users > 0 && org.vehicles > 0 && org.logs > 0).length;
        return { total, completed, rate: Math.round((completed / total) * 100) };
    }, [topOrgs]);

    const [orgPage, setOrgPage] = useState(0);
    const ORG_PAGE_SIZE = 10;
    const [sortKey, setSortKey] = useState<'name' | 'users' | 'vehicles' | 'logs' | 'lastDriveDate'>('logs');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [loading, setLoading] = useState(true);

    type SortKey = 'name' | 'users' | 'vehicles' | 'logs' | 'lastDriveDate';

    const sortedOrgs = useMemo(() => {
        const list = [...topOrgs];
        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a: any, b: any) => {
            if (sortKey === 'name') {
                return dir * (a.name || '').localeCompare(b.name || '', 'ko');
            }
            if (sortKey === 'lastDriveDate') {
                const ta = a.lastDriveDate ? a.lastDriveDate.getTime() : 0;
                const tb = b.lastDriveDate ? b.lastDriveDate.getTime() : 0;
                return dir * (ta - tb);
            }
            return dir * ((a[sortKey] || 0) - (b[sortKey] || 0));
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
        return <span className="ml-1 text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>;
    };

    useEffect(() => {
        loadAllStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadAllStats = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadServiceStats(),
                loadMonthlyStats(),
                loadTopOrganizations(),
            ]);
        } finally {
            setLoading(false);
        }
    };

    // 서비스 개요 통계 + 고도화 지표
    const loadServiceStats = async () => {
        try {
            const [orgSnap, userSnap, logSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'driveLogs')),
            ]);

            const orgs = orgSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
            const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

            const approvedOrgs = orgs.filter(o => o.status === 'approved').length;
            const totalUsers = users.filter(u => u.role !== 'superAdmin').length;
            const adminCount = users.filter(u => u.role === 'admin').length;
            const employeeCount = users.filter(u => u.role === 'employee').length;

            const totalLogs = logSnap.size;
            let totalDistance = 0;

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
            const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
            const dailyMap: Record<string, { ocr: number; manual: number }> = {};
            const dailyDriveMap: Record<string, number> = {};
            const hourMap: Record<string, number> = {};
            const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
            const wauSet = new Set<string>();

            // 평균 주행시간용 맵
            const dailyDurMap: Record<string, number[]> = {};
            const hourDurMap: Record<string, number[]> = {};

            // 30일치 날짜 + 24시간 초기화
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                dailyMap[key] = { ocr: 0, manual: 0 };
                dailyDriveMap[key] = 0;
                dailyDurMap[key] = [];
            }
            for (let h = 0; h < 24; h++) {
                const hKey = `${h.toString().padStart(2, '0')}시`;
                hourMap[hKey] = 0;
                hourDurMap[hKey] = [];
            }

            logSnap.docs.forEach(doc => {
                const data = doc.data();
                // 총 주행거리
                if (data.distance != null && data.distance > 0) {
                    totalDistance += data.distance;
                } else {
                    const start = parseFloat(data.startKm) || 0;
                    const end = parseFloat(data.endKm) || 0;
                    if (end > start) totalDistance += (end - start);
                }

                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                if (!ts || ts < thirtyDaysAgo) return;
                const dateKey = `${ts.getMonth() + 1}/${ts.getDate()}`;

                // 입력 방식 추이
                if (dailyMap[dateKey]) {
                    if (data.inputMethod === 'ocr') dailyMap[dateKey].ocr++;
                    else dailyMap[dateKey].manual++;
                }

                // 일별 운행 건수
                if (dailyDriveMap[dateKey] !== undefined) {
                    dailyDriveMap[dateKey]++;
                }

                // 주행시간 계산 (분 단위)
                const dur = computeDuration(data.startTime, data.endTime);

                // 피크 시간대 (startTime = "HH:MM" 형식) + 히트맵
                if (data.startTime && typeof data.startTime === 'string') {
                    const hourStr = data.startTime.split(':')[0];
                    const hourInt = parseInt(hourStr, 10);
                    if (!isNaN(hourInt) && hourInt >= 0 && hourInt < 24) {
                        const hKey = `${hourInt.toString().padStart(2, '0')}시`;
                        if (hourMap[hKey] !== undefined) hourMap[hKey]++;
                        if (dur > 0 && hourDurMap[hKey]) hourDurMap[hKey].push(dur);
                        // 히트맵: 요일 × 시간대
                        const dayOfWeek = ts.getDay();
                        heatGrid[dayOfWeek][hourInt]++;
                    }
                }

                // 일별 평균 주행시간
                if (dur > 0 && dailyDurMap[dateKey]) {
                    dailyDurMap[dateKey].push(dur);
                }

                // WAU (최근 7일 활성 사용자)
                if (ts >= sevenDaysAgo && data.driverUid) {
                    wauSet.add(data.driverUid);
                }
            });

            // 신청 대기 수
            let pendingApps = 0;
            try {
                const appSnap = await getCountFromServer(
                    query(collection(db, 'orgApplications'), where('status', '==', 'pending'))
                );
                pendingApps = appSnap.data().count;
            } catch { /* ignore */ }

            setStats({
                approvedOrgs,
                totalUsers,
                adminCount,
                employeeCount,
                totalLogs,
                totalDistance: Math.round(totalDistance),
                pendingApps,
            });

            setInputMethodStats(
                Object.entries(dailyMap).map(([date, counts]) => ({ date, ...counts }))
            );

            setDailyDriveStats(
                Object.entries(dailyDriveMap).map(([date, count]) => ({ date, count }))
            );

            setHourlyStats(
                Object.entries(hourMap).map(([hour, count]) => ({ hour, count }))
            );

            setWeeklyActiveRate({ active: wauSet.size, total: totalUsers });

            // 히트맵 데이터 설정
            const heatItems = heatGrid.flatMap((row, dayIdx) =>
                row.map((count, hour) => ({ dayIdx, hour, count })).filter(c => c.count > 0)
            );
            setHeatmapData({
                grid: heatGrid,
                maxCount: Math.max(1, ...heatItems.map(i => i.count)),
            });

            // 일별 평균 주행시간 설정
            setDailyAvgDuration(
                Object.entries(dailyDurMap).map(([date, durations]) => ({
                    date,
                    avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
                }))
            );

            // 시간대별 평균 주행시간 설정
            setHourlyAvgDuration(
                Object.entries(hourDurMap).map(([hour, durations]) => ({
                    hour,
                    avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
                }))
            );
        } catch (err) {
            console.error('서비스 통계 로드 실패:', err);
        }
    };

    // 월간 운영 지표 (전월 대비 포함)
    const loadMonthlyStats = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();

            // 전월 구하기
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;

            const logSnap = await getDocs(collection(db, 'driveLogs'));
            let monthLogs = 0, monthDistance = 0, prevLogs = 0, prevDistance = 0;
            const activeUserSet = new Set();
            const prevActiveUserSet = new Set();

            logSnap.docs.forEach(doc => {
                const data = doc.data();
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                if (!ts) return;

                if (ts.getFullYear() === year && ts.getMonth() === month) {
                    monthLogs++;
                    const dist = computeDistance(data);
                    monthDistance += dist;
                    if (data.driverUid) activeUserSet.add(data.driverUid);
                } else if (ts.getFullYear() === prevYear && ts.getMonth() === prevMonth) {
                    prevLogs++;
                    const dist = computeDistance(data);
                    prevDistance += dist;
                    if (data.driverUid) prevActiveUserSet.add(data.driverUid);
                }
            });

            setMonthlyStats({
                monthLabel: `${year}년 ${month + 1}월`,
                logs: monthLogs,
                distance: Math.round(monthDistance),
                activeUsers: activeUserSet.size,
                prevLogs,
                prevDistance: Math.round(prevDistance),
                prevActiveUsers: prevActiveUserSet.size,
            });
        } catch (err) {
            console.error('월간 통계 로드 실패:', err);
        }
    };

    // 기관별 활성도 + 차량 유형 + 월별 성장
    const loadTopOrganizations = async () => {
        try {
            const [orgSnap, logSnap, userSnap, vehicleSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'driveLogs')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'vehicles')),
            ]);

            const orgMap: Record<string, any> = {};
            const approvalList: any[] = [];
            orgSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.deletedAt || data.status !== 'approved') return;
                orgMap[doc.id] = { id: doc.id, name: data.name || '이름 없음', logs: 0, users: 0, vehicles: 0, distance: 0, lastDriveDate: null, totalDuration: 0, durationCount: 0 };
                if (data.approvedAt) {
                    const approvedDate = data.approvedAt?.toDate ? data.approvedAt.toDate() : new Date(data.approvedAt);
                    if (!isNaN(approvedDate.getTime())) {
                        approvalList.push({
                            id: doc.id,
                            name: data.name || '이름 없음',
                            approvedAt: approvedDate,
                            applicantName: data.applicantName || null,
                            applicantEmail: data.applicantEmail || null,
                        });
                    }
                }
            });

            logSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId]) {
                    orgMap[data.organizationId].logs++;
                    const dist = computeDistance(data);
                    orgMap[data.organizationId].distance += dist;
                    const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                    if (ts) {
                        const prev = orgMap[data.organizationId].lastDriveDate;
                        if (!prev || ts > prev) orgMap[data.organizationId].lastDriveDate = ts;
                    }
                    // 기관별 주행시간 집계
                    const dur = computeDuration(data.startTime, data.endTime);
                    if (dur > 0) {
                        orgMap[data.organizationId].totalDuration += dur;
                        orgMap[data.organizationId].durationCount++;
                    }
                }
            });

            userSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId] && data.role !== 'superAdmin') {
                    orgMap[data.organizationId].users++;
                }
            });

            // 차량 유형 집계
            const fuelMap: Record<string, number> = {};
            vehicleSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId]) {
                    orgMap[data.organizationId].vehicles++;
                }
                const ft = (data.fuelType as string) || 'gasoline';
                fuelMap[ft] = (fuelMap[ft] || 0) + 1;
            });

            setVehicleTypeStats(
                Object.entries(fuelMap)
                    .map(([type, count]) => ({
                        type,
                        label: FUEL_LABELS[type] || type,
                        count,
                        color: FUEL_COLORS[type] || '#9ca3af',
                    }))
                    .sort((a, b) => b.count - a.count)
            );

            const orgList = Object.values(orgMap);
            setTopOrgs(orgList);

            // 기관별 평균 주행시간 (운행 10건 이상인 기관만, 상위 15개)
            const orgDurList = orgList
                .filter((o: any) => o.durationCount >= 10)
                .map((o: any) => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
                .sort((a: any, b: any) => b.avg - a.avg)
                .slice(0, 15);
            setOrgAvgDuration(orgDurList);

            approvalList.sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());
            setRecentApprovals(approvalList);

            // 월별 누적 기관 증가 추이
            if (approvalList.length > 0) {
                const monthMap: Record<string, number> = {};
                const sorted = [...approvalList].sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime());
                sorted.forEach(org => {
                    const key = `${org.approvedAt.getFullYear()}.${(org.approvedAt.getMonth() + 1).toString().padStart(2, '0')}`;
                    monthMap[key] = (monthMap[key] || 0) + 1;
                });
                const months = Object.keys(monthMap).sort();
                let cumulative = 0;
                const growth = months.map(m => {
                    cumulative += monthMap[m];
                    return { month: m, cumulative };
                });
                setMonthlyGrowth(growth);
            }
        } catch (err) {
            console.error('기관 활성도 로드 실패:', err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">서비스 운영 대시보드</h1>
                <button onClick={loadAllStats} className="btn-ghost text-sm flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    새로고침
                </button>
            </div>

            {/* ── 서비스 개요 카드 ── */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="등록 기관" value={stats.approvedOrgs} unit="개" icon="🏢" color="blue"
                        sub={stats.pendingApps > 0 ? `신청 대기 ${stats.pendingApps}건` : null} />
                    <StatCard label="전체 사용자" value={stats.totalUsers} unit="명" icon="👥" color="green"
                        sub={`관리자 ${stats.adminCount} · 직원 ${stats.employeeCount}`} />
                    <StatCard label="총 운행 횟수" value={stats.totalLogs.toLocaleString()} unit="회" icon="🚗" color="purple" />
                    <StatCard label="총 주행 거리" value={stats.totalDistance.toLocaleString()} unit="km" icon="📏" color="orange" />
                </div>
            )}

            {/* ── 월간 운영 지표 (확장) ── */}
            {monthlyStats && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        📅 {monthlyStats.monthLabel} 운영 지표
                    </h2>
                    <div className="grid grid-cols-3 lg:grid-cols-5 gap-4">
                        <MonthlyMetric label="이번 달 운행" value={monthlyStats.logs} prev={monthlyStats.prevLogs} color="primary" />
                        <MonthlyMetric label="이번 달 주행" value={monthlyStats.distance} prev={monthlyStats.prevDistance} unit="km" color="emerald" />
                        <MonthlyMetric label="활성 사용자" value={monthlyStats.activeUsers} prev={monthlyStats.prevActiveUsers} color="amber" />
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl hidden lg:block">
                            <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
                                {weeklyActiveRate.total > 0 ? Math.round((weeklyActiveRate.active / weeklyActiveRate.total) * 100) : 0}
                                <span className="text-sm font-normal ml-0.5">%</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                주간 활성률 ({weeklyActiveRate.active}/{weeklyActiveRate.total})
                            </p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl hidden lg:block">
                            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                                {onboardingStats.rate}<span className="text-sm font-normal ml-0.5">%</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                온보딩 완료 ({onboardingStats.completed}/{onboardingStats.total})
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 일별 운행 추이 (30일) ── */}
            {dailyDriveStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        📈 일별 운행 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        서비스 전체 일별 운행 건수
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={dailyDriveStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorDrive" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyDriveStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}건`, '운행 건수']} />
                                <Area type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} fill="url(#colorDrive)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 입력 방식 시계열 그래프 ── */}
            {inputMethodStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        📊 입력 방식 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        계기판 촬영(OCR)과 수동 입력의 일별 사용 현황
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={inputMethodStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorManual" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(inputMethodStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    formatter={(value: any, name: any) => [
                                        `${value}건`,
                                        name === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력',
                                    ]} />
                                <Legend formatter={(value: string) => value === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력'}
                                    wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                <Area type="monotone" dataKey="ocr" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorOcr)" />
                                <Area type="monotone" dataKey="manual" stroke="#06b6d4" strokeWidth={2} fill="url(#colorManual)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 2열 그리드: 기관 규모별 | 차량 유형별 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 기관 규모별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🏗️ 기관 규모별 분포
                    </h2>
                    <div className="space-y-3">
                        {orgSizeDistribution.map(item => {
                            const maxCount = Math.max(...orgSizeDistribution.map(d => d.count), 1);
                            return (
                                <div key={item.label}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}개</span>
                                    </div>
                                    <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: item.color }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 차량 유형별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        ⛽ 차량 유형별 분포
                    </h2>
                    {vehicleTypeStats.length > 0 ? (
                        <div className="space-y-3">
                            {vehicleTypeStats.map(item => {
                                const maxCount = Math.max(...vehicleTypeStats.map(d => d.count), 1);
                                return (
                                    <div key={item.type}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                            <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                        </div>
                                        <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: item.color }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                    )}
                </div>
            </div>

            {/* ── 2열 그리드: 피크 시간대 | 기관 증가 추이 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 피크 시간대 */}
                {hourlyStats.length > 0 && (
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            ⏰ 시간대별 운행 분포
                        </h2>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">최근 30일 출발 시간 기준</p>
                        <div>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hourlyStats} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={1}
                                        tickFormatter={(v: string) => v.replace('시', '')} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}건`, '출발 건수']} />
                                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                        {hourlyStats.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.count > 0 ? '#8b5cf6' : '#374151'} opacity={entry.count > 0 ? 0.85 : 0.3} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* 기관 증가 추이 */}
                {monthlyGrowth.length > 0 && (
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            🌱 기관 증가 추이
                        </h2>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">월별 누적 승인 기관 수</p>
                        <div>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={monthlyGrowth} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }}
                                        interval={monthlyGrowth.length > 8 ? Math.ceil(monthlyGrowth.length / 6) : 0} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}개`, '누적 기관']} />
                                    <Area type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} fill="url(#colorGrowth)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}
            </div>

            {/* ── 운행 밀도 히트맵 (요일 × 시간대) ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    🔥 운행 밀도 히트맵 (요일 × 시간대)
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">최근 30일 서비스 전체 운행 밀도</p>
                <HeatmapGrid data={heatmapData} />
            </div>

            {/* ── 신규 승인 기관 차트 (날짜별) ── */}
            {approvalChartData.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        🆕 신규 승인 기관
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        날짜별 신규 승인된 기관 수 (최근 30일간)
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={approvalChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorApproval" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }}
                                    interval={approvalChartData.length > 15 ? Math.ceil(approvalChartData.length / 8) : 0} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}개`, '승인 기관']} />
                                <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} fill="url(#colorApproval)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 3열 그리드: 평균 주행시간 차트 ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    ⏱️ 평균 주행시간 분석
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                    startTime과 endTime 기반 주행시간 (최근 30일)
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 일별 평균 주행시간 */}
                    {dailyAvgDuration.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">📅 일별 평균 주행시간</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={dailyAvgDuration} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorAvgDur" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyAvgDuration.length / 8)} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                        allowDecimals={false} unit="분" />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}분`, '평균 주행시간']} />
                                    <Area type="monotone" dataKey="avg" stroke="#ec4899" strokeWidth={2} fill="url(#colorAvgDur)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* 시간대별 평균 주행시간 */}
                    {hourlyAvgDuration.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">⏰ 시간대별 평균 주행시간</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hourlyAvgDuration} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={1}
                                        tickFormatter={(v: string) => v.replace('시', '')} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                        allowDecimals={false} unit="분" />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}분`, '평균 주행시간']} />
                                    <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                                        {hourlyAvgDuration.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.avg > 0 ? '#f472b6' : '#374151'} opacity={entry.avg > 0 ? 0.85 : 0.3} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* 기관별 평균 주행시간 (운행 10건 이상) */}
                {orgAvgDuration.length > 0 && (
                    <div className="mt-6">
                        <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">🏢 기관별 평균 주행시간 (운행 10건 이상, 상위 15개)</h3>
                        <ResponsiveContainer width="100%" height={Math.max(200, orgAvgDuration.length * 32)} minWidth={1}>
                            <BarChart data={orgAvgDuration} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={false} unit="분" />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#d1d5db' }} tickLine={false}
                                    axisLine={false} width={100} />
                                <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}분`, '평균 주행시간']} />
                                <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                                    {orgAvgDuration.map((_entry, idx) => (
                                        <Cell key={idx} fill={`hsl(${330 - idx * 8}, 70%, ${55 + idx * 1.5}%)`} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* ── 비활성 기관 경고 ── */}
            {inactiveOrgs.length > 0 && (
                <div className="glass-card p-5 border-l-4 border-l-amber-500 dark:border-l-amber-400">
                    <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-2">
                        ⚠️ 비활성 기관 ({inactiveOrgs.length}개)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-3">
                        최근 30일간 운행 기록이 없는 기관 (사용자 1명 이상)
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {inactiveOrgs.slice(0, 20).map(org => (
                            <span key={org.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50">
                                <span className="w-2 h-2 rounded-full bg-amber-400" />
                                {org.name}
                                <span className="text-amber-400 dark:text-amber-500">
                                    {org.lastDriveDate ? `${Math.floor((Date.now() - org.lastDriveDate.getTime()) / 86400000)}일 전` : '운행 없음'}
                                </span>
                            </span>
                        ))}
                        {inactiveOrgs.length > 20 && (
                            <span className="text-xs text-surface-400 dark:text-surface-500 self-center">
                                +{inactiveOrgs.length - 20}개 더
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── 기관별 활성도 ── */}
            {topOrgs.length > 0 && (() => {
                const totalPages = Math.ceil(sortedOrgs.length / ORG_PAGE_SIZE);
                const pagedOrgs = sortedOrgs.slice(orgPage * ORG_PAGE_SIZE, (orgPage + 1) * ORG_PAGE_SIZE);
                return (
                    <div className="glass-card p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">🏆 활성도 ({sortedOrgs.length} 기관)</h2>
                            {totalPages > 1 && (
                                <div className="flex items-center gap-2 text-sm">
                                    <button
                                        onClick={() => setOrgPage(p => Math.max(0, p - 1))}
                                        disabled={orgPage === 0}
                                        className="px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
                                    >
                                        ←
                                    </button>
                                    <span className="text-surface-500 dark:text-surface-400 min-w-[60px] text-center">
                                        {orgPage + 1} / {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setOrgPage(p => Math.min(totalPages - 1, p + 1))}
                                        disabled={orgPage >= totalPages - 1}
                                        className="px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
                                    >
                                        →
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-surface-100 dark:border-surface-700 text-surface-500 dark:text-surface-400">
                                        <th className="text-left py-2 px-1.5 sm:px-3 font-medium">#</th>
                                        <th className="text-left py-2 px-1.5 sm:px-3 font-medium cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('name')}>
                                            <span className="hidden sm:inline">기관명</span><span className="sm:hidden">🏢</span>{sortIndicator('name')}
                                        </th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('users')}>
                                            <span className="hidden sm:inline">사용자</span><span className="sm:hidden">👤</span>{sortIndicator('users')}
                                        </th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('vehicles')}>
                                            <span className="hidden sm:inline">차량</span><span className="sm:hidden">🚗</span>{sortIndicator('vehicles')}
                                        </th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('logs')}>
                                            <span className="hidden sm:inline">운행 횟수</span><span className="sm:hidden">📊</span>{sortIndicator('logs')}
                                        </th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('lastDriveDate')}>
                                            <span className="hidden sm:inline">최근 운행</span><span className="sm:hidden">📅</span>{sortIndicator('lastDriveDate')}
                                        </th>
                                        <th className="text-center py-2 px-1.5 sm:px-3 font-medium hidden sm:table-cell">온보딩</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedOrgs.map((org, i) => {
                                        const rank = orgPage * ORG_PAGE_SIZE + i;
                                        const onboarded = org.users > 0 && org.vehicles > 0 && org.logs > 0;
                                        return (
                                            <tr key={org.id} className="border-b border-surface-50 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
                                                <td className="py-2.5 px-1.5 sm:px-3">
                                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400">
                                                        {rank + 1}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-1.5 sm:px-3 font-medium text-surface-800 dark:text-surface-200 max-w-[120px] sm:max-w-none truncate">{org.name}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.users}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.vehicles}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.logs.toLocaleString()}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">
                                                    {org.lastDriveDate
                                                        ? `${org.lastDriveDate.getMonth() + 1}/${org.lastDriveDate.getDate()}`
                                                        : '-'}
                                                </td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-center hidden sm:table-cell">
                                                    {onboarded
                                                        ? <span className="text-emerald-500">✅</span>
                                                        : <span className="text-surface-300 dark:text-surface-600">○</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

/* ── 헬퍼 ── */

function computeDistance(data: any): number {
    if (data.distance != null && data.distance > 0) return data.distance;
    const start = parseFloat(data.startKm) || 0;
    const end = parseFloat(data.endKm) || 0;
    return end > start ? end - start : 0;
}

/** startTime, endTime ("HH:MM" 형식)으로 주행시간(분) 계산. 비정상 시 0 반환 */
function computeDuration(startTime: any, endTime: any): number {
    if (!startTime || !endTime || typeof startTime !== 'string' || typeof endTime !== 'string') return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur <= 0) dur += 1440; // 자정 넘김 처리
    if (dur <= 0 || dur >= 1440) return 0; // 비정상 데이터 필터링
    return dur;
}

const tooltipStyle = {
    contentStyle: {
        backgroundColor: 'rgba(17, 24, 39, 0.9)',
        border: '1px solid #374151',
        borderRadius: '12px',
        fontSize: '13px',
        color: '#e5e7eb',
    },
    labelStyle: { color: '#9ca3af', marginBottom: '4px' },
    itemStyle: { color: '#e5e7eb' },
} as const;

/* ── 통계 카드 ── */

interface StatCardProps {
    label: string;
    value: string | number;
    unit: string;
    icon: string;
    color: string;
    sub?: string | null;
}

function StatCard({ label, value, unit, icon, color, sub }: StatCardProps) {
    const colorMap: Record<string, string> = {
        blue: 'from-blue-50 to-blue-100 border-blue-200 dark:from-blue-950/50 dark:to-blue-900/30 dark:border-blue-800/50',
        green: 'from-emerald-50 to-emerald-100 border-emerald-200 dark:from-emerald-950/50 dark:to-emerald-900/30 dark:border-emerald-800/50',
        purple: 'from-purple-50 to-purple-100 border-purple-200 dark:from-purple-950/50 dark:to-purple-900/30 dark:border-purple-800/50',
        orange: 'from-orange-50 to-orange-100 border-orange-200 dark:from-orange-950/50 dark:to-orange-900/30 dark:border-orange-800/50',
    };

    return (
        <div className={`rounded-2xl border p-4 bg-gradient-to-br ${colorMap[color] || colorMap.blue}`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{label}</span>
                <span className="text-lg">{icon}</span>
            </div>
            <p className="text-2xl font-bold text-surface-800 dark:text-surface-100">
                {value}<span className="text-sm font-normal text-surface-400 dark:text-surface-400 ml-1">{unit}</span>
            </p>
            {sub && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{sub}</p>}
        </div>
    );
}

/* ── 월간 지표 카드 (전월 대비) ── */

interface MonthlyMetricProps {
    label: string;
    value: number;
    prev: number;
    unit?: string;
    color: string;
}

function MonthlyMetric({ label, value, prev, unit, color }: MonthlyMetricProps) {
    const diff = prev > 0 ? Math.round(((value - prev) / prev) * 100) : (value > 0 ? 100 : 0);
    const colorClass: Record<string, string> = {
        primary: 'text-primary-600 dark:text-primary-400',
        emerald: 'text-emerald-600 dark:text-emerald-400',
        amber: 'text-amber-600 dark:text-amber-400',
    };

    return (
        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
            <p className={`text-2xl font-bold ${colorClass[color] || colorClass.primary}`}>
                {value.toLocaleString()}
                {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
            </p>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{label}</p>
            {prev > 0 && (
                <p className={`text-xs mt-0.5 ${diff >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)}% vs 전월
                </p>
            )}
        </div>
    );
}
