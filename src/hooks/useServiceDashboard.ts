import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where, getCountFromServer, getAggregateFromServer, sum, count, QuerySnapshot, DocumentData, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
    FUEL_LABELS, FUEL_COLORS, VT_LABELS, VT_COLORS,
    computeDistance, computeDuration, ORG_PAGE_SIZE,
} from '../components/superAdmin/dashboard/dashboardUtils';
import type { SortKey } from '../components/superAdmin/dashboard/dashboardUtils';

interface OrgStat {
    id: string; name: string; address: string; lat: number; lng: number;
    logs: number; users: number; vehicles: number; distance: number;
    lastDriveDate: Date | null; totalDuration: number; durationCount: number;
    [key: string]: unknown;
}

// 공유 스냅샷 타입
type SharedSnaps = {
    orgSnap: QuerySnapshot<DocumentData, DocumentData>;
    userSnap: QuerySnapshot<DocumentData, DocumentData>;
    logSnap: QuerySnapshot<DocumentData, DocumentData>;
    vehicleSnap: QuerySnapshot<DocumentData, DocumentData>;
    hipassCardSnap: QuerySnapshot<DocumentData, DocumentData>;
};

export default function useServiceDashboard() {
    const [stats, setStats] = useState<{
        approvedOrgs: number; totalUsers: number; adminCount: number; employeeCount: number;
        totalLogs: number; totalDistance: number; pendingApps: number;
    } | null>(null);
    const [monthlyStats, setMonthlyStats] = useState<{
        monthLabel: string; logs: number; distance: number; activeUsers: number;
        prevLogs: number; prevDistance: number; prevActiveUsers: number;
    } | null>(null);
    const [topOrgs, setTopOrgs] = useState<OrgStat[]>([]);

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
        loadAllStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            const orgs = orgSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));
            const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));

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
                Object.entries(dailyDriveMap).map(([date, c]) => ({ date, count: c }))
            );

            setDailyActiveUserStats(
                Object.entries(dailyActiveUserMap).map(([date, uidSet]) => ({ date, users: uidSet.size }))
            );

            setDailyActiveOrgStats(dailyOrgData);

            setHourlyStats(
                Object.entries(hourMap).map(([hour, c]) => ({ hour, count: c }))
            );

            setWeeklyActiveRate({ active: wauSet.size, total: totalUsers });

            const heatItems = heatGrid.flatMap((row, dayIdx) =>
                row.map((c, hour) => ({ dayIdx, hour, count: c })).filter(c => c.count > 0)
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
            const orgMap: Record<string, OrgStat> = {};
            const approvalList: { id: string; name: string; approvedAt: Date; applicantName: string | null; applicantEmail: string | null }[] = [];
            const firstEmpDaysList: { days: number; approvedAt: Date }[] = [];
            orgSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.deletedAt || data.status !== 'approved') return;
                orgMap[doc.id] = { id: doc.id, name: data.name || '이름 없음', address: data.address || data.aiVerifyDetail?.address || '', lat: data.lat || 0, lng: data.lng || 0, logs: 0, users: 0, vehicles: 0, distance: 0, lastDriveDate: null, totalDuration: 0, durationCount: 0 };
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
                    .map(([name, c]) => ({ name, count: c }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
            );

            setFuelTypeStats(
                Object.entries(fuelMap)
                    .map(([type, c]) => ({
                        type,
                        label: FUEL_LABELS[type] || type,
                        count: c,
                        color: FUEL_COLORS[type] || '#9ca3af',
                    }))
                    .sort((a, b) => b.count - a.count)
            );

            setVehicleTypeStats(
                Object.entries(vtMap)
                    .map(([type, c]) => ({
                        type,
                        label: VT_LABELS[type] || type,
                        count: c,
                        color: VT_COLORS[type] || '#9ca3af',
                    }))
                    .sort((a, b) => b.count - a.count)
            );

            setVehicleModelStats(
                Object.entries(modelMap)
                    .map(([model, c]) => ({ model, count: c }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 15)
            );

            const orgList = Object.values(orgMap);
            setTopOrgs(orgList);

            const orgDurList = orgList
                .filter((o) => o.durationCount >= 10)
                .map((o) => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
                .sort((a, b) => b.avg - a.avg)
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

            const [fuelAgg, hipassAgg, fuelMonthAgg, hipassMonthAgg, fuelPrevMonthAgg, hipassPrevMonthAgg, fuelRecentSnap, hipassRecentSnap] = await Promise.all([
                getAggregateFromServer(query(fuelCol), { totalCount: count(), totalCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol), { totalCount: count(), totalAmount: sum('chargeAmount') }),
                getAggregateFromServer(query(fuelCol, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthAmount: sum('chargeAmount') }),
                getAggregateFromServer(query(fuelCol, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevCost: sum('fuelCost') }),
                getAggregateFromServer(query(hipassCol, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevAmount: sum('chargeAmount') }),
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
    const NOTIF_TYPE_LABELS_LOCAL: Record<string, string> = {
        admin_notice: '관리자 공지', notice: '공지사항',
        reservation_confirmed: '예약 확정', reservation_reminder: '예약 알림',
        reservation_cancelled: '예약 취소', reservation_changed: '예약 변경',
        reservation_cancelled_maintenance: '정비 취소', drive_log_reminder: '운행일지 알림',
        no_show_reminder: '노쇼 알림', approval: '승인', rejection: '반려',
        maintenance: '정비 알림', drive: '운행 알림', system: '시스템',
    };
    const NOTIF_TYPE_COLORS_LOCAL: Record<string, string> = {
        admin_notice: '#8b5cf6', notice: '#a78bfa',
        reservation_confirmed: '#f59e0b', reservation_reminder: '#fbbf24',
        reservation_cancelled: '#ef4444', reservation_changed: '#f97316',
        reservation_cancelled_maintenance: '#dc2626', drive_log_reminder: '#10b981',
        no_show_reminder: '#3b82f6', approval: '#6b7280', rejection: '#9ca3af',
        maintenance: '#eab308', drive: '#22c55e', system: '#64748b',
    };
    const loadNotificationStats = async () => {
        try {
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
            const notifCol = collection(db, 'notifications');

            const [totalCountResult, readCountResult, notifRecentSnap] = await Promise.all([
                getCountFromServer(query(notifCol)),
                getCountFromServer(query(notifCol, where('read', '==', true))),
                getDocs(query(notifCol, where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)))),
            ]);

            const total = totalCountResult.data().count;
            const readCount = readCountResult.data().count;
            const unreadCount = total - readCount;

            const dailyMap: Record<string, { sent: number; read: number }> = {};
            const typeMap: Record<string, number> = {};

            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                dailyMap[key] = { sent: 0, read: 0 };
            }

            notifRecentSnap.docs.forEach(doc => {
                const data = doc.data();

                const t = (data.type as string) || 'system';
                typeMap[t] = (typeMap[t] || 0) + 1;

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
                        type: NOTIF_TYPE_LABELS_LOCAL[type] || type,
                        count: cnt,
                        color: NOTIF_TYPE_COLORS_LOCAL[type] || colorPalette[idx % colorPalette.length],
                    }))
                    .sort((a, b) => b.count - a.count)
            );
        } catch (err) {
            console.error('알림 통계 로드 실패:', err);
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
        orgSizeDistribution,
        fuelTypeStats,
        vehicleTypeStats,
        vehicleModelStats,
        hipassRatio,
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
        orgPage,
        setOrgPage,
        sortKey,
        sortDir,
        handleSort,
        sortIndicator,
        loadAllStats,
    };
}
