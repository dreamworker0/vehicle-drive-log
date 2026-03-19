import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where, getCountFromServer, getAggregateFromServer, sum, count, QuerySnapshot, DocumentData, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend, Cell,
    PieChart, Pie,
} from 'recharts';
import HeatmapGrid from '../common/HeatmapGrid';

const FUEL_LABELS: Record<string, string> = { gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기차' };
const FUEL_COLORS: Record<string, string> = { gasoline: '#f59e0b', diesel: '#6366f1', lpg: '#14b8a6', electric: '#3b82f6' };
const VT_LABELS: Record<string, string> = { compact: '경형', sedan: '승용', van: '승합', truck: '트럭', bus: '버스' };
const VT_COLORS: Record<string, string> = { compact: '#f59e0b', sedan: '#3b82f6', van: '#8b5cf6', truck: '#ef4444', bus: '#14b8a6' };

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리 + 고도화 인사이트
 */
export default function ServiceDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [monthlyStats, setMonthlyStats] = useState<any>(null);
    const [topOrgs, setTopOrgs] = useState<any[]>([]);

    const [inputMethodStats, setInputMethodStats] = useState<{ date: string; ocr: number; manual: number }[]>([]);

    // 고도화 state
    const [_dailyDriveStats, setDailyDriveStats] = useState<{ date: string; count: number }[]>([]);
    const [dailyActiveUserStats, setDailyActiveUserStats] = useState<{ date: string; users: number }[]>([]);
    const [dailyActiveOrgStats, setDailyActiveOrgStats] = useState<{ date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[]>([]);
    const [hourlyStats, setHourlyStats] = useState<{ hour: string; count: number }[]>([]);
    const [fuelTypeStats, setFuelTypeStats] = useState<{ type: string; label: string; count: number; color: string }[]>([]);
    const [vehicleTypeStats, setVehicleTypeStats] = useState<{ type: string; label: string; count: number; color: string }[]>([]);
    const [vehicleModelStats, setVehicleModelStats] = useState<{ model: string; count: number }[]>([]);
    const [hipassRatio, setHipassRatio] = useState<{ withHipass: number; withoutHipass: number }>({ withHipass: 0, withoutHipass: 0 });
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

    // 공유 스냅샷 타입
    type SharedSnaps = {
        orgSnap: QuerySnapshot<DocumentData, DocumentData>;
        userSnap: QuerySnapshot<DocumentData, DocumentData>;
        logSnap: QuerySnapshot<DocumentData, DocumentData>;
        vehicleSnap: QuerySnapshot<DocumentData, DocumentData>;
        hipassCardSnap: QuerySnapshot<DocumentData, DocumentData>;
    };

    const loadAllStats = async () => {
        setLoading(true);
        try {
            // 공유 컬렉션을 1회만 조회
            const [orgSnap, userSnap, logSnap, vehicleSnap, hipassCardSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'driveLogs')),
                getDocs(collection(db, 'vehicles')),
                getDocs(collection(db, 'hipassCards')),
            ]);
            const shared: SharedSnaps = { orgSnap, userSnap, logSnap, vehicleSnap, hipassCardSnap };

            // 공유 데이터로 통계 계산 + 독립 컬렉션은 개별 로드
            await Promise.all([
                processServiceStats(shared),
                processMonthlyStats(shared),
                processTopOrganizations(shared),
                loadFuelHipassStats(),
                loadNotificationStats(),
            ]);
        } finally {
            setLoading(false);
        }
    };

    // 서비스 개요 통계 + 고도화 지표
    const processServiceStats = async ({ orgSnap, userSnap, logSnap }: SharedSnaps) => {
        try {
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
            const dailyActiveUserMap: Record<string, Set<string>> = {};
            const hourMap: Record<string, number> = {};
            const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
            const wauSet = new Set<string>();

            // 평균 주행시간용 맵
            const dailyDurMap: Record<string, number[]> = {};
            const hourDurMap: Record<string, number[]> = {};

            // ── 일별 기관 추이 계산 (신청일 기준, 상태별 분류) ──
            const allOrgList = orgs
                .filter(o => o.createdAt)
                .map(o => ({
                    id: o.id,
                    status: o.status as string,
                    deletedAt: o.deletedAt || null,
                    createdAt: o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt),
                }));

            // 기관별 직원 존재 여부 (현재 기준)
            const orgHasEmployee = new Set<string>();
            users.forEach(u => {
                if (u.organizationId && u.role !== 'superAdmin') {
                    orgHasEmployee.add(u.organizationId);
                }
            });

            // 누적 그래프: 30일 전 이전에 신청된 기관을 초기값으로 세팅
            let cumActive = 0, cumInactive = 0, cumRejected = 0, cumDeleted = 0;
            allOrgList.forEach(o => {
                if (o.createdAt >= thirtyDaysAgo) return;
                if (o.status === 'rejected') cumRejected++;
                else if (o.deletedAt) cumDeleted++;
                else if (o.status === 'approved' && orgHasEmployee.has(o.id)) cumActive++;
                else if (o.status === 'approved') cumInactive++;
            });

            // 30일치 날짜별: 누적 합산
            const dailyOrgData: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[] = [];
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
                const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                dailyMap[key] = { ocr: 0, manual: 0 };
                dailyDriveMap[key] = 0;
                dailyActiveUserMap[key] = new Set();
                dailyDurMap[key] = [];

                let dayA = 0, dayI = 0, dayR = 0, dayD = 0;
                allOrgList.filter(o => o.createdAt >= dayStart && o.createdAt <= dayEnd).forEach(o => {
                    if (o.status === 'rejected') { cumRejected++; dayR++; }
                    else if (o.deletedAt) { cumDeleted++; dayD++; }
                    else if (o.status === 'approved' && orgHasEmployee.has(o.id)) { cumActive++; dayA++; }
                    else if (o.status === 'approved') { cumInactive++; dayI++; }
                });

                dailyOrgData.push({ date: key, active: cumActive, inactive: cumInactive, rejected: cumRejected, deleted: cumDeleted, dayActive: dayA, dayInactive: dayI, dayRejected: dayR, dayDeleted: dayD });
            }
            for (let h = 0; h < 24; h++) {
                const hKey = `${h.toString().padStart(2, '0')}시`;
                hourMap[hKey] = 0;
                hourDurMap[hKey] = [];
            }

            logSnap.docs.forEach(doc => {
                const data = doc.data();
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

                if (dailyMap[dateKey]) {
                    if (data.inputMethod === 'ocr') dailyMap[dateKey].ocr++;
                    else dailyMap[dateKey].manual++;
                }

                if (dailyDriveMap[dateKey] !== undefined) {
                    dailyDriveMap[dateKey]++;
                }

                if (dailyActiveUserMap[dateKey] && data.driverUid) {
                    dailyActiveUserMap[dateKey].add(data.driverUid);
                }

                const dur = computeDuration(data.startTime, data.endTime);

                if (data.startTime && typeof data.startTime === 'string') {
                    const hourStr = data.startTime.split(':')[0];
                    const hourInt = parseInt(hourStr, 10);
                    if (!isNaN(hourInt) && hourInt >= 0 && hourInt < 24) {
                        const hKey = `${hourInt.toString().padStart(2, '0')}시`;
                        if (hourMap[hKey] !== undefined) hourMap[hKey]++;
                        if (dur > 0 && hourDurMap[hKey]) hourDurMap[hKey].push(dur);
                        const dayOfWeek = ts.getDay();
                        heatGrid[dayOfWeek][hourInt]++;
                    }
                }

                if (dur > 0 && dailyDurMap[dateKey]) {
                    dailyDurMap[dateKey].push(dur);
                }

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

            setDailyActiveUserStats(
                Object.entries(dailyActiveUserMap).map(([date, uidSet]) => ({ date, users: uidSet.size }))
            );

            setDailyActiveOrgStats(dailyOrgData);

            setHourlyStats(
                Object.entries(hourMap).map(([hour, count]) => ({ hour, count }))
            );

            setWeeklyActiveRate({ active: wauSet.size, total: totalUsers });

            const heatItems = heatGrid.flatMap((row, dayIdx) =>
                row.map((count, hour) => ({ dayIdx, hour, count })).filter(c => c.count > 0)
            );
            setHeatmapData({
                grid: heatGrid,
                maxCount: Math.max(1, ...heatItems.map(i => i.count)),
            });

            setDailyAvgDuration(
                Object.entries(dailyDurMap).map(([date, durations]) => ({
                    date,
                    avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
                }))
            );

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
    const processMonthlyStats = async ({ logSnap }: SharedSnaps) => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();

            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;

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
    const processTopOrganizations = async ({ orgSnap, logSnap, userSnap, vehicleSnap, hipassCardSnap }: SharedSnaps) => {
        try {
            const orgMap: Record<string, any> = {};
            const approvalList: any[] = [];
            const firstEmpDaysList: { days: number; approvedAt: Date }[] = [];
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
                if (data.timeToFirstEmployeeDays != null && data.approvedAt) {
                    const approvedDate = data.approvedAt?.toDate ? data.approvedAt.toDate() : new Date(data.approvedAt);
                    if (!isNaN(approvedDate.getTime())) {
                        firstEmpDaysList.push({ days: data.timeToFirstEmployeeDays, approvedAt: approvedDate });
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

            // 연료 유형 + 차량 유형 + 모델 집계
            const fuelMap: Record<string, number> = {};
            const vtMap: Record<string, number> = {};
            const modelMap: Record<string, number> = {};
            vehicleSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId]) {
                    orgMap[data.organizationId].vehicles++;
                }
                const ft = (data.fuelType as string) || 'gasoline';
                fuelMap[ft] = (fuelMap[ft] || 0) + 1;
                const vt = (data.vehicleType as string) || 'sedan';
                vtMap[vt] = (vtMap[vt] || 0) + 1;
                const model = (data.modelName as string) || (data.displayName as string) || (data.name as string) || '알 수 없음';
                modelMap[model] = (modelMap[model] || 0) + 1;
            });

            // 하이패스 집계 (hipassCards 컬렉션 기반)
            const hipassVehicleSet = new Set<string>();
            const orgHipassMap: Record<string, number> = {};
            hipassCardSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.vehicleId) {
                    hipassVehicleSet.add(data.vehicleId);
                }
                if (data.organizationId && orgMap[data.organizationId]) {
                    const orgName = orgMap[data.organizationId].name;
                    orgHipassMap[orgName] = (orgHipassMap[orgName] || 0) + 1;
                }
            });
            const hipassWithCount = hipassVehicleSet.size;
            const hipassTotalCount = vehicleSnap.size;

            setHipassRatio({ withHipass: hipassWithCount, withoutHipass: hipassTotalCount - hipassWithCount });

            setHipassTopOrgs(
                Object.entries(orgHipassMap)
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
            );

            setFuelTypeStats(
                Object.entries(fuelMap)
                    .map(([type, count]) => ({
                        type,
                        label: FUEL_LABELS[type] || type,
                        count,
                        color: FUEL_COLORS[type] || '#9ca3af',
                    }))
                    .sort((a, b) => b.count - a.count)
            );

            setVehicleTypeStats(
                Object.entries(vtMap)
                    .map(([type, count]) => ({
                        type,
                        label: VT_LABELS[type] || type,
                        count,
                        color: VT_COLORS[type] || '#9ca3af',
                    }))
                    .sort((a, b) => b.count - a.count)
            );

            setVehicleModelStats(
                Object.entries(modelMap)
                    .map(([model, count]) => ({ model, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 15)
            );

            const orgList = Object.values(orgMap);
            setTopOrgs(orgList);

            const orgDurList = orgList
                .filter((o: any) => o.durationCount >= 10)
                .map((o: any) => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
                .sort((a: any, b: any) => b.avg - a.avg)
                .slice(0, 15);
            setOrgAvgDuration(orgDurList);

            approvalList.sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());

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

            // ── 첫 직원 등록 소요시간 통계 계산 ──
            if (firstEmpDaysList.length > 0) {
                const dayValues = firstEmpDaysList.map(d => d.days).sort((a, b) => a - b);
                const total = dayValues.length;
                const avg = Math.round(dayValues.reduce((s, v) => s + v, 0) / total * 10) / 10;
                const median = total % 2 === 0
                    ? (dayValues[total / 2 - 1] + dayValues[total / 2]) / 2
                    : dayValues[Math.floor(total / 2)];
                const sameDayCount = dayValues.filter(d => d === 0).length;
                const sameDayRate = Math.round((sameDayCount / total) * 100);

                setFirstEmployeeStats({ avg, median, sameDayRate, total });

                const buckets = [
                    { label: '당일', min: 0, max: 0, color: '#22c55e' },
                    { label: '1일', min: 1, max: 1, color: '#3b82f6' },
                    { label: '2~3일', min: 2, max: 3, color: '#6366f1' },
                    { label: '4~7일', min: 4, max: 7, color: '#8b5cf6' },
                    { label: '8~14일', min: 8, max: 14, color: '#f59e0b' },
                    { label: '15~30일', min: 15, max: 30, color: '#f97316' },
                    { label: '30일+', min: 31, max: Infinity, color: '#ef4444' },
                ];
                setFirstEmployeeDist(
                    buckets.map(b => ({
                        label: b.label,
                        count: dayValues.filter(d => d >= b.min && d <= b.max).length,
                        color: b.color,
                    }))
                );

                const monthAvgMap: Record<string, number[]> = {};
                firstEmpDaysList.forEach(({ days, approvedAt: aDate }) => {
                    const key = `${aDate.getFullYear()}.${(aDate.getMonth() + 1).toString().padStart(2, '0')}`;
                    if (!monthAvgMap[key]) monthAvgMap[key] = [];
                    monthAvgMap[key].push(days);
                });
                const trendMonths = Object.keys(monthAvgMap).sort();
                setFirstEmployeeTrend(
                    trendMonths.map(m => ({
                        month: m,
                        avg: Math.round(monthAvgMap[m].reduce((s, v) => s + v, 0) / monthAvgMap[m].length * 10) / 10,
                    }))
                );
            }
        } catch (err) {
            console.error('기관 활성도 로드 실패:', err);
        }
    };

    // 주유/하이패스 통계 로드 (서버 집계 + 기간 필터 최적화)
    const loadFuelHipassStats = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;
            const thirtyDaysAgo = new Date(year, month, now.getDate() - 29);

            // 이번 달, 지난 달 날짜 범위 (문자열 비교용)
            const curMonthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const curMonthEnd = `${year}-${String(month + 1).padStart(2, '0')}-31`;
            const prevMonthStart = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
            const prevMonthEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-31`;
            const recentDateStr = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(thirtyDaysAgo.getDate()).padStart(2, '0')}`;

            // 30일치 날짜 초기화
            const fuelDailyMap: Record<string, number> = {};
            const hipassDailyMap: Record<string, number> = {};
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                fuelDailyMap[key] = 0;
                hipassDailyMap[key] = 0;
            }

            const fuelCol = collection(db, 'fuelLogs');
            const hipassCol = collection(db, 'hipassCharges');

            // 1) 서버 집계로 전체 합계/카운트 (문서 전송 없이 서버에서 계산)
            const [fuelAgg, hipassAgg, fuelMonthAgg, hipassMonthAgg, fuelPrevMonthAgg, hipassPrevMonthAgg, fuelRecentSnap, hipassRecentSnap] = await Promise.all([
                getAggregateFromServer(query(fuelCol), { totalCount: count(), totalCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol), { totalCount: count(), totalAmount: sum('chargeAmount') }),
                getAggregateFromServer(query(fuelCol, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthAmount: sum('chargeAmount') }),
                getAggregateFromServer(query(fuelCol, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevAmount: sum('chargeAmount') }),
                // 2) 최근 30일 문서만 가져와서 일별 차트 생성
                getDocs(query(fuelCol, where('date', '>=', recentDateStr))),
                getDocs(query(hipassCol, where('date', '>=', recentDateStr))),
            ]);

            // 주유 일별 집계 (최근 30일 문서만)
            fuelRecentSnap.docs.forEach(doc => {
                const data = doc.data();
                const dateStr = data.date as string;
                if (!dateStr) return;
                const [y, m, dd] = dateStr.split('-').map(Number);
                const parsed = new Date(y, m - 1, dd);
                if (parsed >= thirtyDaysAgo) {
                    const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                    if (fuelDailyMap[key] !== undefined) fuelDailyMap[key] += (data.fuelCost || 0);
                }
            });

            setFuelStats({
                totalCount: fuelAgg.data().totalCount,
                totalCost: fuelAgg.data().totalCost ?? 0,
                monthCount: fuelMonthAgg.data().monthCount,
                monthCost: fuelMonthAgg.data().monthCost ?? 0,
                prevMonthCost: fuelPrevMonthAgg.data().prevCost ?? 0,
            });
            setDailyFuelCost(Object.entries(fuelDailyMap).map(([date, cost]) => ({ date, cost })));

            // 하이패스 일별 집계 (최근 30일 문서만)
            hipassRecentSnap.docs.forEach(doc => {
                const data = doc.data();
                const dateStr = data.date as string;
                if (!dateStr) return;
                const [y, m, dd] = dateStr.split('-').map(Number);
                const parsed = new Date(y, m - 1, dd);
                if (parsed >= thirtyDaysAgo) {
                    const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                    if (hipassDailyMap[key] !== undefined) hipassDailyMap[key] += (data.chargeAmount || 0);
                }
            });

            setHipassStats({
                totalCount: hipassAgg.data().totalCount,
                totalAmount: hipassAgg.data().totalAmount ?? 0,
                monthCount: hipassMonthAgg.data().monthCount,
                monthAmount: hipassMonthAgg.data().monthAmount ?? 0,
                prevMonthAmount: hipassPrevMonthAgg.data().prevAmount ?? 0,
            });
            setDailyHipassAmount(Object.entries(hipassDailyMap).map(([date, amount]) => ({ date, amount })));
        } catch (err) {
            console.error('주유/하이패스 통계 로드 실패:', err);
        }
    };

    // 알림 통계 로드
    const NOTIF_TYPE_LABELS: Record<string, string> = {
        admin_notice: '관리자 공지',
        notice: '공지사항',
        reservation_confirmed: '예약 확정',
        reservation_reminder: '예약 알림',
        reservation_cancelled: '예약 취소',
        reservation_changed: '예약 변경',
        reservation_cancelled_maintenance: '정비 취소',
        drive_log_reminder: '운행일지 알림',
        no_show_reminder: '노쇼 알림',
        approval: '승인',
        rejection: '반려',
        maintenance: '정비 알림',
        drive: '운행 알림',
        system: '시스템',
    };
    const NOTIF_TYPE_COLORS: Record<string, string> = {
        admin_notice: '#8b5cf6',
        notice: '#a78bfa',
        reservation_confirmed: '#f59e0b',
        reservation_reminder: '#fbbf24',
        reservation_cancelled: '#ef4444',
        reservation_changed: '#f97316',
        reservation_cancelled_maintenance: '#dc2626',
        drive_log_reminder: '#10b981',
        no_show_reminder: '#3b82f6',
        approval: '#6b7280',
        rejection: '#9ca3af',
        maintenance: '#eab308',
        drive: '#22c55e',
        system: '#64748b',
    };
    const loadNotificationStats = async () => {
        try {
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
            const notifCol = collection(db, 'notifications');

            // 1) 서버 집계로 전체 카운트 + 읽음 카운트 (문서 전송 없이)
            const [totalCountResult, readCountResult, notifRecentSnap] = await Promise.all([
                getCountFromServer(query(notifCol)),
                getCountFromServer(query(notifCol, where('read', '==', true))),
                // 2) 최근 30일 알림만 가져와서 일별 차트 + 타입 분석
                getDocs(query(notifCol, where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)))),
            ]);

            const total = totalCountResult.data().count;
            const readCount = readCountResult.data().count;
            const unreadCount = total - readCount;

            const dailyMap: Record<string, { sent: number; read: number }> = {};
            const typeMap: Record<string, number> = {};

            // 30일치 날짜 초기화
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                dailyMap[key] = { sent: 0, read: 0 };
            }

            notifRecentSnap.docs.forEach(doc => {
                const data = doc.data();

                // 타입별 집계 (최근 30일 기준)
                const t = (data.type as string) || 'system';
                typeMap[t] = (typeMap[t] || 0) + 1;

                // 일별 집계
                const ts = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : null);
                if (ts && ts >= thirtyDaysAgo) {
                    const dateKey = `${ts.getMonth() + 1}/${ts.getDate()}`;
                    if (dailyMap[dateKey]) {
                        dailyMap[dateKey].sent++;
                        if (data.read) dailyMap[dateKey].read++;
                    }
                }
            });

            setNotifSummary({
                total,
                read: readCount,
                unread: unreadCount,
                readRate: total > 0 ? Math.round((readCount / total) * 100) : 0,
            });

            setDailyNotifStats(
                Object.entries(dailyMap).map(([date, counts]) => ({ date, ...counts }))
            );

            const colorPalette = ['#8b5cf6', '#f59e0b', '#3b82f6', '#10b981', '#6b7280', '#ef4444', '#ec4899', '#06b6d4'];
            setNotifTypeStats(
                Object.entries(typeMap)
                    .map(([type, cnt], idx) => ({
                        type: NOTIF_TYPE_LABELS[type] || type,
                        count: cnt,
                        color: NOTIF_TYPE_COLORS[type] || colorPalette[idx % colorPalette.length],
                    }))
                    .sort((a, b) => b.count - a.count)
            );
        } catch (err) {
            console.error('알림 통계 로드 실패:', err);
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
                    <StatCard label="신청 기관" value={stats.approvedOrgs} unit="개" icon="🏢" color="blue"
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




            {/* ── 일별 기관 추이 (30일) ── */}
            {dailyActiveOrgStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        🏢 일별 기관 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        신청일 기준 일별 건수 — 거절 · 삭제 · 미활성(직원 미등록) · 활성(직원 등록)
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={280} minWidth={1}>
                            <AreaChart data={dailyActiveOrgStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorRejectedOrg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6b7280" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#6b7280" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorDeletedOrg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorInactiveOrg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorActiveOrg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyActiveOrgStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    content={({ active, payload, label }: any) => {
                                        if (!active || !payload?.length) return null;
                                        const data = payload[0]?.payload;
                                        if (!data) return null;
                                        const total = data.dayRejected + data.dayDeleted + data.dayInactive + data.dayActive;
                                        const items = [
                                            { label: '거절', count: data.dayRejected, color: '#6b7280', icon: '⚫' },
                                            { label: '삭제', count: data.dayDeleted, color: '#f59e0b', icon: '🟡' },
                                            { label: '미활성', count: data.dayInactive, color: '#ef4444', icon: '🔴' },
                                            { label: '활성', count: data.dayActive, color: '#22c55e', icon: '🟢' },
                                        ];
                                        return (
                                            <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                                <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400 }}>총 {total}건</span></p>
                                                {items.map(it => (
                                                    <p key={it.label} style={{ color: it.color, margin: '3px 0' }}>
                                                        {it.icon} {it.label}: <b>{it.count}건</b>
                                                    </p>
                                                ))}
                                            </div>
                                        );
                                    }} />
                                <Legend formatter={(value: string) =>
                                    value === 'dayRejected' ? '⚫ 거절' :
                                    value === 'dayDeleted' ? '🟡 삭제된 기관' :
                                    value === 'dayInactive' ? '🔴 미활성 (직원 미등록)' :
                                    '🟢 활성 (직원 등록)'
                                } wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                <Area type="monotone" dataKey="dayRejected" stackId="org" stroke="#6b7280" strokeWidth={2} fill="url(#colorRejectedOrg)" />
                                <Area type="monotone" dataKey="dayDeleted" stackId="org" stroke="#f59e0b" strokeWidth={2} fill="url(#colorDeletedOrg)" />
                                <Area type="monotone" dataKey="dayInactive" stackId="org" stroke="#ef4444" strokeWidth={2} fill="url(#colorInactiveOrg)" />
                                <Area type="monotone" dataKey="dayActive" stackId="org" stroke="#22c55e" strokeWidth={2} fill="url(#colorActiveOrg)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 일별 활성 사용자 추이 (30일) ── */}
            {dailyActiveUserStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        👤 일별 활성 사용자 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        하루에 1회 이상 운행한 고유 사용자 수
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={280} minWidth={1}>
                            <AreaChart data={dailyActiveUserStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorDau" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyActiveUserStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    formatter={(value: number) => [`${value}명`, '활성 사용자']}
                                />
                                <Area type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2.5}
                                    fill="url(#colorDau)" dot={{ r: 2, fill: '#06b6d4' }} activeDot={{ r: 5, fill: '#06b6d4' }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 첫 직원 등록 소요시간 분석 ── */}
            {firstEmployeeStats && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        ⏱ 기관 승인 → 첫 직원 등록 소요시간
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        승인일부터 첫 번째 직원이 가입하기까지 걸린 일수 (총 {firstEmployeeStats.total}개 기관 기준)
                    </p>

                    {/* 요약 카드 */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                {firstEmployeeStats.avg}<span className="text-sm font-normal ml-0.5">일</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">평균 소요일</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                {firstEmployeeStats.median}<span className="text-sm font-normal ml-0.5">일</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">중앙값</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                                {firstEmployeeStats.sameDayRate}<span className="text-sm font-normal ml-0.5">%</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">당일 등록 비율</p>
                        </div>
                    </div>

                    {/* 소요일 분포 히스토그램 + 월별 트렌드 (2열 그리드) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* 소요일 분포 */}
                        {firstEmployeeDist.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📊 소요일 분포</h3>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <BarChart data={firstEmployeeDist} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip
                                            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                            labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                            formatter={(value: number) => [`${value}개 기관`, '기관 수']}
                                        />
                                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                            {firstEmployeeDist.map((entry, idx) => (
                                                <Cell key={idx} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {/* 월별 평균 소요일 트렌드 */}
                        {firstEmployeeTrend.length > 1 && (
                            <div>
                                <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📈 월별 평균 소요일 추이</h3>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={firstEmployeeTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorFirstEmpTrend" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            label={{ value: '일', position: 'insideTopLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                                        <Tooltip
                                            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                            labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                            formatter={(value: number) => [`${value}일`, '평균 소요일']}
                                        />
                                        <Area type="monotone" dataKey="avg" stroke="#8b5cf6" strokeWidth={2.5}
                                            fill="url(#colorFirstEmpTrend)" dot={{ r: 3, fill: '#8b5cf6' }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 입력 방식 스택 그래프 ── */}
            {inputMethodStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        📊 입력 방식 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={inputMethodStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorManual" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(inputMethodStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    content={({ active, payload, label }: any) => {
                                        if (!active || !payload?.length) return null;
                                        const data = payload[0]?.payload;
                                        if (!data) return null;
                                        const total = data.ocr + data.manual;
                                        return (
                                            <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                                <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400 }}>총 {total}건</span></p>
                                                <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                                    📷 계기판 촬영: <b>{data.ocr}건</b>
                                                </p>
                                                <p style={{ color: '#06b6d4', margin: '3px 0' }}>
                                                    ⌨️ 수동 입력: <b>{data.manual}건</b>
                                                </p>
                                            </div>
                                        );
                                    }} />
                                <Legend formatter={(value: string) => value === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력'}
                                    wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                <Area type="monotone" dataKey="manual" stackId="input" stroke="#06b6d4" strokeWidth={2} fill="url(#colorManual)" />
                                <Area type="monotone" dataKey="ocr" stackId="input" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorOcr)" />
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

                {/* 연료 유형별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        ⛽ 연료 유형별 분포
                    </h2>
                    {fuelTypeStats.length > 0 ? (
                        <div className="space-y-3">
                            {fuelTypeStats.map(item => {
                                const maxCount = Math.max(...fuelTypeStats.map(d => d.count), 1);
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

            {/* ── 차량 유형별 분포 ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                    🚗 차량 유형별 분포
                </h2>
                {vehicleTypeStats.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {vehicleTypeStats.map(item => {
                            const total = vehicleTypeStats.reduce((s, d) => s + d.count, 0);
                            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                            const ICONS: Record<string, string> = { compact: '🚙', sedan: '🚗', van: '🚐', truck: '🚚', bus: '🚌' };
                            return (
                                <div key={item.type} className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                    <div className="text-3xl mb-2">{ICONS[item.type] || '🚗'}</div>
                                    <p className="text-sm font-medium text-surface-600 dark:text-surface-300">{item.label}</p>
                                    <p className="text-2xl font-bold mt-1" style={{ color: item.color }}>
                                        {item.count}<span className="text-sm font-normal ml-0.5">대</span>
                                    </p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">{pct}%</p>
                                    <div className="mt-2 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                )}
            </div>

            {/* ── 차량 모델별 분포 ── */}
            {vehicleModelStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🚘 차량 모델별 분포
                    </h2>
                    <div className="space-y-2">
                        {vehicleModelStats.map((item, idx) => {
                            const maxCount = vehicleModelStats[0]?.count || 1;
                            const colors = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#a855f7', '#6d28d9'];
                            const color = colors[idx % colors.length];
                            return (
                                <div key={item.model}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.model}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                    </div>
                                    <div className="h-5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: color }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 하이패스 연결 현황 ── */}
            {(hipassRatio.withHipass > 0 || hipassRatio.withoutHipass > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 하이패스 연결 비율 도넛 */}
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🛣️ 하이패스 연결 비율
                        </h2>
                        {(() => {
                            const total = hipassRatio.withHipass + hipassRatio.withoutHipass;
                            const pct = total > 0 ? Math.round((hipassRatio.withHipass / total) * 100) : 0;
                            const donutData = [
                                { name: '연결됨', value: hipassRatio.withHipass, color: '#14b8a6' },
                                { name: '미연결', value: hipassRatio.withoutHipass, color: '#374151' },
                            ];
                            return (
                                <div className="flex items-center justify-center gap-8">
                                    <div className="relative">
                                        <ResponsiveContainer width={180} height={180}>
                                            <PieChart>
                                                <Pie
                                                    data={donutData}
                                                    dataKey="value"
                                                    cx="50%" cy="50%"
                                                    innerRadius={55} outerRadius={80}
                                                    paddingAngle={3}
                                                    startAngle={90} endAngle={-270}
                                                    stroke="none"
                                                >
                                                    {donutData.map((entry, idx) => (
                                                        <Cell key={idx} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    {...tooltipStyle}
                                                    formatter={(value: any, name: any) => [`${value}대`, name]}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        {/* 중앙 텍스트 */}
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="text-3xl font-bold text-teal-500 dark:text-teal-400">{pct}%</span>
                                            <span className="text-xs text-surface-400 dark:text-surface-500">연결율</span>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
                                            <span className="text-sm text-surface-600 dark:text-surface-300">연결됨</span>
                                            <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withHipass}대</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#374151' }} />
                                            <span className="text-sm text-surface-600 dark:text-surface-300">미연결</span>
                                            <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withoutHipass}대</span>
                                        </div>
                                        <div className="border-t border-surface-200 dark:border-surface-700 pt-2">
                                            <span className="text-xs text-surface-400 dark:text-surface-500">전체 {total}대</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* 하이패스 사용 기관 TOP 5 */}
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🏆 하이패스 사용 기관 TOP 5
                        </h2>
                        {hipassTopOrgs.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hipassTopOrgs} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#d1d5db' }} tickLine={false}
                                        axisLine={false} width={100} />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}대`, '하이패스 차량']} />
                                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                                        {hipassTopOrgs.map((_entry, idx) => (
                                            <Cell key={idx} fill={`hsl(${170 - idx * 12}, 65%, ${45 + idx * 5}%)`} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-sm text-surface-400 dark:text-surface-500">하이패스 연결 차량이 없습니다</p>
                        )}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 주유 / 하이패스 월간 지표 */}
                {(fuelStats || hipassStats) && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 lg:col-span-2">
                        {fuelStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 주유</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.monthCost.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 주유 건수</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.totalCost.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                        {hipassStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 하이패스</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.monthAmount.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 하이패스 충전</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.totalAmount.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── 주유/하이패스 일별 추이 (30일) ── */}
            {(dailyFuelCost.length > 0 || dailyHipassAmount.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 주유 비용 추이 */}
                    {dailyFuelCost.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                ⛽ 주유 비용 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 주유 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyFuelCost} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorFuelCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyFuelCost.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={(value: any) => [`${Number(value).toLocaleString()}원`, '주유 금액']} />
                                        <Area type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} fill="url(#colorFuelCost)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* 하이패스 충전 추이 */}
                    {dailyHipassAmount.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                🛣️ 하이패스 충전 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 하이패스 충전 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyHipassAmount} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorHipassAmt" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyHipassAmount.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={(value: any) => [`${Number(value).toLocaleString()}원`, '충전 금액']} />
                                        <Area type="monotone" dataKey="amount" stroke="#14b8a6" strokeWidth={2} fill="url(#colorHipassAmt)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            )}

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

            {/* ── 알림 활용 현황 ── */}
            {notifSummary && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🔔 알림 활용 현황
                    </h2>

                    {/* 요약 카드 */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                                {notifSummary.total.toLocaleString()}
                                <span className="text-sm font-normal ml-0.5">건</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 알림 발송</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                {notifSummary.read.toLocaleString()}
                                <span className="text-sm font-normal ml-0.5">건</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">읽음</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                                {notifSummary.unread.toLocaleString()}
                                <span className="text-sm font-normal ml-0.5">건</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">미읽음</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className={`text-2xl font-bold ${notifSummary.readRate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : notifSummary.readRate >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {notifSummary.readRate}
                                <span className="text-sm font-normal ml-0.5">%</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">읽음률</p>
                        </div>
                    </div>

                    {/* 일별 알림 추이 */}
                    {dailyNotifStats.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">📊 일별 알림 추이 (최근 30일)</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={dailyNotifStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorNotifSent" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0.05} />
                                        </linearGradient>
                                        <linearGradient id="colorNotifRead" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyNotifStats.length / 8)} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip {...tooltipStyle}
                                        content={({ active, payload, label }: any) => {
                                            if (!active || !payload?.length) return null;
                                            const data = payload[0]?.payload;
                                            if (!data) return null;
                                            const rate = data.sent > 0 ? Math.round((data.read / data.sent) * 100) : 0;
                                            return (
                                                <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                                    <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label}</p>
                                                    <p style={{ color: '#818cf8', margin: '3px 0' }}>📨 발송: <b>{data.sent}건</b></p>
                                                    <p style={{ color: '#34d399', margin: '3px 0' }}>✅ 읽음: <b>{data.read}건</b></p>
                                                    <p style={{ color: '#9ca3af', margin: '3px 0' }}>읽음률: <b>{rate}%</b></p>
                                                </div>
                                            );
                                        }} />
                                    <Legend formatter={(value: string) => value === 'sent' ? '📨 발송' : '✅ 읽음'}
                                        wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                    <Area type="monotone" dataKey="sent" stackId="notif" stroke="#818cf8" strokeWidth={2} fill="url(#colorNotifSent)" />
                                    <Area type="monotone" dataKey="read" stackId="notif" stroke="#34d399" strokeWidth={2} fill="url(#colorNotifRead)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* 알림 타입별 분포 */}
                    {notifTypeStats.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-3">📋 알림 타입별 분포</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {notifTypeStats.map(item => {
                                    const maxCount = Math.max(...notifTypeStats.map(d => d.count), 1);
                                    return (
                                        <div key={item.type}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-sm text-surface-600 dark:text-surface-300">{item.type}</span>
                                                <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}건</span>
                                            </div>
                                            <div className="h-4 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
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
                    )}
                </div>
            )}

            {/* ── 운행 밀도 히트맵 (요일 × 시간대) ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    🔥 운행 밀도 히트맵 (요일 × 시간대)
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">최근 30일 서비스 전체 운행 밀도</p>
                <HeatmapGrid data={heatmapData} />
            </div>



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
