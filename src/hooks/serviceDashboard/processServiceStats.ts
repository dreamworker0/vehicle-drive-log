import { DocumentData, query, collection, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { computeDuration } from '../../components/superAdmin/dashboard/dashboardUtils';
import type { SharedSnaps, ServiceStatsSetters } from './types';

/**
 * 서비스 개요 통계 + 고도화 지표
 * (일별 입력방식, 일별 운행, 일별 활성 사용자, 시간별 운행, WAU, 히트맵, 평균 주행시간 등)
 */
export async function processServiceStats(
    shared: SharedSnaps,
    setters: ServiceStatsSetters,
): Promise<void> {
    const { orgSnap, userSnap, logSnap, favoriteSnap } = shared;
    const {
        setStats, setFavoriteUserRatio, setInputMethodStats, setDailyDriveStats,
        setDailyActiveUserStats, setDailyActiveOrgStats, setHourlyStats,
        setWeeklyActiveRate, setFavoriteStats, setFavoriteLogRatio,
        setHeatmapData, setDailyAvgDuration, setHourlyAvgDuration,
    } = setters;

    try {
        const orgs = orgSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));
        const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));

        // 즐겨찾기 사용자 집계
        const userFavoritesMap = new Map<string, Set<string>>();
        favoriteSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.userId) {
                if (!userFavoritesMap.has(data.userId)) {
                    userFavoritesMap.set(data.userId, new Set());
                }
                if (data.name) userFavoritesMap.get(data.userId)!.add(data.name);
                if (data.address) userFavoritesMap.get(data.userId)!.add(data.address);
            }
        });

        const validUsersForFav = users.filter(u => u.role !== 'superAdmin');
        let withFavCount = 0;
        validUsersForFav.forEach(u => {
            if (userFavoritesMap.has(u.id)) withFavCount++;
        });
        setFavoriteUserRatio({
            total: validUsersForFav.length,
            withFavorite: withFavCount,
            rate: validUsersForFav.length > 0 ? Math.round((withFavCount / validUsersForFav.length) * 100) : 0,
        });

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
        const dailyFavoriteMap: Record<string, { favorite: number; normal: number }> = {};
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
            dailyFavoriteMap[key] = { favorite: 0, normal: 0 };

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

            if (dailyFavoriteMap[dateKey]) {
                const isFav = data.driverUid && data.destination &&
                              userFavoritesMap.get(data.driverUid)?.has(data.destination);
                if (isFav) dailyFavoriteMap[dateKey].favorite++;
                else dailyFavoriteMap[dateKey].normal++;
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

        setStats(prev => ({
            ...prev,
            approvedOrgs,
            totalUsers,
            adminCount,
            employeeCount,
            totalLogs,
            totalDistance: Math.round(totalDistance),
            pendingApps,
            calendarSyncOrgs: prev?.calendarSyncOrgs || 0,
        }));

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

        setFavoriteStats(
            Object.entries(dailyFavoriteMap).map(([date, counts]) => ({ date, ...counts }))
        );

        let totalFav = 0;
        let totalNorm = 0;
        Object.values(dailyFavoriteMap).forEach(c => {
            totalFav += c.favorite;
            totalNorm += c.normal;
        });
        const favTotalLog = totalFav + totalNorm;
        setFavoriteLogRatio({
            total: favTotalLog,
            favorite: totalFav,
            normal: totalNorm,
            rate: favTotalLog > 0 ? Math.round((totalFav / favTotalLog) * 100) : 0,
        });

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
}
