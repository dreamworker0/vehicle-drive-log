import { getFirestore } from "firebase-admin/firestore";
import {
    computeDistance, computeDuration, toDate, groupByOrg,
} from "./dashboardHelpers";
import { toKSTDate, getKSTDateString, getKSTDayOfWeek } from "../utils/kstDate";
import {
    computeOrgBase, computeUserStats, computeFavoriteUsers,
    computeVehicleStats, computeHipassStats,
    computeFirstEmployeeAnalysis, computeMonthlyGrowth,
    computeFunnelData, computeOrgSizeDistribution,
    assembleFuelTypeStats, assembleVehicleTypeStats, assembleModelStats,
} from "./dashboardSections";

/**
 * SuperAdmin 대시보드 통계를 배치 계산하여 system/ 문서에 캐싱.
 * 기존 6개 컬렉션 풀스캔(~35,000 reads/load)을 3건 read로 대체.
 *
 * 저장 경로:
 *   - system/dashboardStats       (카운터 & 요약)
 *   - system/dashboardTimeSeries  (30일 시계열 & 분포)
 *   - system/dashboardOrgRankings (조직별 데이터)
 */

export async function computeAllDashboardStats(): Promise<void> {
    const startTime = Date.now();
    const db = getFirestore();

    const kstNow = toKSTDate();
    const year = kstNow.getFullYear();
    const month = kstNow.getMonth();
    // Firestore UTC Timestamp 비교용: UTC 기준 Date 사용
    const thirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgoStr = getKSTDateString(thirtyDaysAgo);
    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;

    // 1. 7개 컬렉션 병렬 조회
    const [orgSnap, userSnap, logSnap, vehicleSnap, hipassCardSnap, favoriteSnap, pendingAppSnap, reservationSnap] = await Promise.all([
        db.collection("organizations").get(),
        db.collection("users").get(),
        db.collection("driveLogs").get(),
        db.collection("vehicles").get(),
        db.collection("hipassCards").get(),
        db.collection("favorites").get(),
        db.collection("orgApplications").where("status", "==", "pending").count().get(),
        db.collection("reservations").where("date", ">=", thirtyDaysAgoStr).get(),
    ]);

    // 1.5. 사전 분류 (O(N+M) 최적화를 위해 기관별로 문서 분배)
    const userByOrg = groupByOrg(userSnap.docs);
    const logByOrg = groupByOrg(logSnap.docs);
    const vehicleByOrg = groupByOrg(vehicleSnap.docs);
    const hipassByOrg = groupByOrg(hipassCardSnap.docs);
    const reservationByOrg = groupByOrg(reservationSnap.docs);

    function buildStats(orgFilterId: string | null) {
        // 기관 필터 유무에 따라 순회할 배열 선택
        const currentOrgDocs = orgFilterId ? orgSnap.docs.filter(d => d.id === orgFilterId) : orgSnap.docs;
        const currentUserDocs = orgFilterId ? (userByOrg[orgFilterId] || []) : userSnap.docs;
        const currentLogDocs = orgFilterId ? (logByOrg[orgFilterId] || []) : logSnap.docs;
        const currentVehicleDocs = orgFilterId ? (vehicleByOrg[orgFilterId] || []) : vehicleSnap.docs;
        const currentHipassDocs = orgFilterId ? (hipassByOrg[orgFilterId] || []) : hipassCardSnap.docs;
        const currentReservationDocs = orgFilterId ? (reservationByOrg[orgFilterId] || []) : reservationSnap.docs;

        // ── 2. 기관 기초 데이터 ──
        const { approvedOrgMap, allOrgList, approvalList, firstEmpDaysList } = computeOrgBase(currentOrgDocs, orgFilterId);

        // ── 3. 유저 집계 ──
        const userStats = computeUserStats(currentUserDocs, approvedOrgMap, orgFilterId);

        // ── 4. 즐겨찾기 집계 ──
        const { userFavoritesMap, withFavCount } = computeFavoriteUsers(favoriteSnap, currentUserDocs, orgFilterId);

        // ── 5. 운행일지 집계 (메인 루프) ──
        let totalDistance = 0;
        const dailyInputMap: Record<string, { ocr: number; manual: number }> = {};
        const dailyDriveMap: Record<string, number> = {};
        const dailyActiveUserMap: Record<string, Set<string>> = {};
        const dailyFavoriteMap: Record<string, { favorite: number; normal: number }> = {};
        const dailyDurMap: Record<string, number[]> = {};
        const hourMap: Record<string, number> = {};
        const hourDurMap: Record<string, number[]> = {};
        const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
        const wauSet = new Set<string>();

        let monthLogs = 0, monthDistance = 0, prevLogs = 0, prevDistance = 0;
        const monthActiveUsers = new Set<string>();
        const prevMonthActiveUsers = new Set<string>();

        const dateKeys: string[] = [];
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            dateKeys.push(key);
            dailyInputMap[key] = { ocr: 0, manual: 0 };
            dailyDriveMap[key] = 0;
            dailyActiveUserMap[key] = new Set();
            dailyFavoriteMap[key] = { favorite: 0, normal: 0 };
            dailyDurMap[key] = [];
        }
        for (let h = 0; h < 24; h++) {
            const hKey = `${h.toString().padStart(2, "0")}시`;
            hourMap[hKey] = 0;
            hourDurMap[hKey] = [];
        }

        currentLogDocs.forEach(doc => {
            const data = doc.data();
            if (orgFilterId && data.organizationId !== orgFilterId) return;
            const dist = computeDistance(data);
            totalDistance += dist;

            if (data.organizationId && approvedOrgMap[data.organizationId]) {
                const org = approvedOrgMap[data.organizationId];
                org.logs++;
                org.distance += dist;
                const ts = toDate(data.timestamp);
                if (ts) {
                    const tsIso = ts.toISOString();
                    if (!org.lastDriveDate || tsIso > org.lastDriveDate) {
                        org.lastDriveDate = tsIso;
                    }
                }
                const dur = computeDuration(data.startTime, data.endTime);
                if (dur > 0) { org.totalDuration += dur; org.durationCount++; }
            }

            const ts = toDate(data.timestamp);
            if (ts) {
                const kstTsMonth = toKSTDate(ts);
                if (kstTsMonth.getFullYear() === year && kstTsMonth.getMonth() === month) {
                    monthLogs++; monthDistance += dist;
                    if (data.driverUid) monthActiveUsers.add(data.driverUid);
                } else if (kstTsMonth.getFullYear() === prevYear && kstTsMonth.getMonth() === prevMonth) {
                    prevLogs++; prevDistance += dist;
                    if (data.driverUid) prevMonthActiveUsers.add(data.driverUid);
                }
            }

            if (!ts || ts < thirtyDaysAgo) return;
            const dateKey = getKSTDateString(ts);
            if (dailyInputMap[dateKey]) {
                if (data.inputMethod === "ocr") dailyInputMap[dateKey].ocr++;
                else dailyInputMap[dateKey].manual++;
            }
            if (dailyDriveMap[dateKey] !== undefined) dailyDriveMap[dateKey]++;
            if (dailyActiveUserMap[dateKey] && data.driverUid) dailyActiveUserMap[dateKey].add(data.driverUid);
            if (dailyFavoriteMap[dateKey]) {
                const isFav = data.driverUid && data.destination && userFavoritesMap.get(data.driverUid)?.has(data.destination);
                if (isFav) dailyFavoriteMap[dateKey].favorite++;
                else dailyFavoriteMap[dateKey].normal++;
            }

            const dur = computeDuration(data.startTime, data.endTime);
            if (data.startTime && typeof data.startTime === "string") {
                const hourInt = parseInt(data.startTime.split(":")[0], 10);
                if (!isNaN(hourInt) && hourInt >= 0 && hourInt < 24) {
                    const hKey = `${hourInt.toString().padStart(2, "0")}시`;
                    if (hourMap[hKey] !== undefined) hourMap[hKey]++;
                    if (dur > 0 && hourDurMap[hKey]) hourDurMap[hKey].push(dur);
                    heatGrid[getKSTDayOfWeek(ts)][hourInt]++;
                }
            }
            if (dur > 0 && dailyDurMap[dateKey]) dailyDurMap[dateKey].push(dur);
            if (ts >= sevenDaysAgo && data.driverUid) wauSet.add(data.driverUid);
        });

        // ── 5.5. 예약 집계 ──
        const dailyResMap: Record<string, { regular: number; quick: number; recommendation: number; normal: number; single: number; multiDay: number; recurring: number }> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            dailyResMap[key] = { regular: 0, quick: 0, recommendation: 0, normal: 0, single: 0, multiDay: 0, recurring: 0 };
        }

        const futureResMap: Record<string, { single: number; multiDay: number; recurring: number }> = {};
        const todayStart = new Date(year, month, kstNow.getDate());
        for (let i = 0; i < 30; i++) {
            const d = new Date(todayStart);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            futureResMap[key] = { single: 0, multiDay: 0, recurring: 0 };
        }

        let qTotal = 0, qQuick = 0, qRegular = 0;
        let recTotal = 0, recRecommendation = 0, recNormal = 0;
        let rtSingle = 0, rtMultiDay = 0, rtRecurring = 0;
        let ftSingle = 0, ftMultiDay = 0, ftRecurring = 0;
        const processedCalendarEvents = new Set<string>();

        currentReservationDocs.forEach(doc => {
            const data = doc.data();
            if (orgFilterId && data.organizationId !== orgFilterId) return;
            if (data.status === "cancelled") return;
            if (data.calendarEventId) {
                const dedupeKey = `${data.calendarEventId}_${data.date || ""}`;
                if (processedCalendarEvents.has(dedupeKey)) return;
                processedCalendarEvents.add(dedupeKey);
            }
            const dStr = data.date as string;
            if (!dStr) return;
            const [y, m, dd] = dStr.split("-").map(Number);
            const parsed = new Date(y, m - 1, dd);

            if (parsed >= thirtyDaysAgo) {
                const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                qTotal++; recTotal++;
                if (data.isQuickDrive) { qQuick++; if (dailyResMap[key]) dailyResMap[key].quick++; }
                else { qRegular++; if (dailyResMap[key]) dailyResMap[key].regular++; }
                if (data.source === "recommendation") { recRecommendation++; if (dailyResMap[key]) dailyResMap[key].recommendation++; }
                else { recNormal++; if (dailyResMap[key]) dailyResMap[key].normal++; }
                if (data.recurringGroupId) { rtRecurring++; if (dailyResMap[key]) dailyResMap[key].recurring++; }
                else if (data.groupId) { rtMultiDay++; if (dailyResMap[key]) dailyResMap[key].multiDay++; }
                else { rtSingle++; if (dailyResMap[key]) dailyResMap[key].single++; }
            }

            if (parsed >= todayStart) {
                const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                if (data.recurringGroupId) { if (futureResMap[key]) { futureResMap[key].recurring++; ftRecurring++; } }
                else if (data.groupId) { if (futureResMap[key]) { futureResMap[key].multiDay++; ftMultiDay++; } }
                else { if (futureResMap[key]) { futureResMap[key].single++; ftSingle++; } }
            }
        });

        const quickDriveRatio = { total: qTotal, quick: qQuick, regular: qRegular, rate: qTotal > 0 ? Math.round((qQuick / qTotal) * 100) : 0 };
        const recommendationRatio = { total: recTotal, recommendation: recRecommendation, normal: recNormal, rate: recTotal > 0 ? Math.round((recRecommendation / recTotal) * 100) : 0 };
        const quickDriveStats = Object.entries(dailyResMap).map(([date, counts]) => ({ date, regular: counts.regular, quick: counts.quick }));
        const recommendationStats = Object.entries(dailyResMap).map(([date, counts]) => ({ date, recommendation: counts.recommendation, normal: counts.normal }));

        const rtTotal = rtSingle + rtMultiDay + rtRecurring;
        const reservationTypeRatio = {
            total: rtTotal, single: rtSingle, multiDay: rtMultiDay, recurring: rtRecurring,
            singleRate: rtTotal > 0 ? Math.round((rtSingle / rtTotal) * 100) : 0,
            multiDayRate: rtTotal > 0 ? Math.round((rtMultiDay / rtTotal) * 100) : 0,
            recurringRate: rtTotal > 0 ? Math.round((rtRecurring / rtTotal) * 100) : 0,
        };
        const reservationTypeStats = Object.entries(dailyResMap).map(([date, counts]) => ({ date, single: counts.single, multiDay: counts.multiDay, recurring: counts.recurring }));

        const ftTotal = ftSingle + ftMultiDay + ftRecurring;
        const futureReservationTypeRatio = {
            total: ftTotal, single: ftSingle, multiDay: ftMultiDay, recurring: ftRecurring,
            singleRate: ftTotal > 0 ? Math.round((ftSingle / ftTotal) * 100) : 0,
            multiDayRate: ftTotal > 0 ? Math.round((ftMultiDay / ftTotal) * 100) : 0,
            recurringRate: ftTotal > 0 ? Math.round((ftRecurring / ftTotal) * 100) : 0,
        };
        const futureReservationTypeStats = Object.entries(futureResMap).map(([date, counts]) => ({ date, single: counts.single, multiDay: counts.multiDay, recurring: counts.recurring }));

        // ── 6. 차량 집계 ──
        const vehicleResult = computeVehicleStats(currentVehicleDocs, approvedOrgMap, orgFilterId);

        // ── 7. 하이패스 집계 ──
        const { hipassVehicleSet, orgHipassMap } = computeHipassStats(currentHipassDocs, approvedOrgMap, orgFilterId);

        // ── 8. 일별 기관 추이 ──
        const orgListFiltered = allOrgList.filter(o => o.createdAt);
        let cumActive = 0, cumInactive = 0, cumRejected = 0, cumDeleted = 0;
        orgListFiltered.forEach(o => {
            if (orgFilterId && o.id !== orgFilterId) return;
            if (!o.createdAt || o.createdAt >= thirtyDaysAgo) return;
            if (o.status === "rejected") cumRejected++;
            else if (o.deletedAt) cumDeleted++;
            else if (o.status === "approved" && userStats.orgHasEmployee.has(o.id)) cumActive++;
            else if (o.status === "approved") cumInactive++;
        });

        const dailyOrgData: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[] = [];
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
            const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

            let dayA = 0, dayI = 0, dayR = 0, dayD = 0;
            orgListFiltered.filter(o => o.createdAt && o.createdAt >= dayStart && o.createdAt <= dayEnd).forEach(o => {
                if (orgFilterId && o.id !== orgFilterId) return;
                if (o.status === "rejected") { cumRejected++; dayR++; }
                else if (o.deletedAt) { cumDeleted++; dayD++; }
                else if (o.status === "approved" && userStats.orgHasEmployee.has(o.id)) { cumActive++; dayA++; }
                else if (o.status === "approved") { cumInactive++; dayI++; }
            });

            dailyOrgData.push({ date: key, active: cumActive, inactive: cumInactive, rejected: cumRejected, deleted: cumDeleted, dayActive: dayA, dayInactive: dayI, dayRejected: dayR, dayDeleted: dayD });
        }

        // ── 9. 결과 조립 ──
        const approvedOrgs = allOrgList.filter(o => o.status === "approved").length;
        const topOrgs = Object.values(approvedOrgMap);

        const monthlyGrowth = computeMonthlyGrowth(approvalList);
        const firstEmployee = computeFirstEmployeeAnalysis(firstEmpDaysList);
        const funnelData = computeFunnelData(topOrgs);
        const orgSizeDistribution = computeOrgSizeDistribution(topOrgs);

        const orgAvgDuration = topOrgs
            .filter(o => o.durationCount >= 10)
            .map(o => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 15);

        const totalOrgsCount = topOrgs.length;
        const onboardingCompleted = topOrgs.filter(o => o.users > 0 && o.vehicles > 0 && o.logs > 0).length;

        // 시계열 데이터 조립
        const inputMethodStats = Object.entries(dailyInputMap).map(([date, counts]) => ({ date, ...counts })).sort((a, b) => a.date.localeCompare(b.date));
        const dailyDriveStats = Object.entries(dailyDriveMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
        const dailyActiveUserStats = Object.entries(dailyActiveUserMap).map(([date, uidSet]) => ({ date, users: uidSet.size })).sort((a, b) => a.date.localeCompare(b.date));
        const favoriteStatsArr = Object.entries(dailyFavoriteMap).map(([date, counts]) => ({ date, ...counts })).sort((a, b) => a.date.localeCompare(b.date));
        const hourlyStats = Object.entries(hourMap).map(([hour, count]) => ({ hour, count }));
        const dailyAvgDuration = Object.entries(dailyDurMap).map(([date, durations]) => ({
            date, avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
        })).sort((a, b) => a.date.localeCompare(b.date));
        const hourlyAvgDuration = Object.entries(hourDurMap).map(([hour, durations]) => ({
            hour, avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
        }));

        let totalFav = 0, totalNorm = 0;
        Object.values(dailyFavoriteMap).forEach(c => { totalFav += c.favorite; totalNorm += c.normal; });
        const favTotal = totalFav + totalNorm;

        const heatItems = heatGrid.flatMap((row, dayIdx) =>
            row.map((c, hour) => ({ dayIdx, hour, count: c })).filter(c => c.count > 0)
        );

        return {
            dashboardStats: {
                approvedOrgs, totalUsers: userStats.totalUsers, adminCount: userStats.adminCount, employeeCount: userStats.employeeCount,
                totalLogs: logSnap.size, totalDistance: Math.round(totalDistance),
                pendingApps: orgFilterId ? 0 : pendingAppSnap.data().count,
                calendarSyncOrgs: vehicleResult.calendarSyncOrgSet.size, calendarSyncVehicles: vehicleResult.calendarSyncCount,
                calendarNotSyncVehicles: vehicleResult.calendarNotSyncCount,
                fuelTypeStats: assembleFuelTypeStats(vehicleResult.fuelMap),
                vehicleTypeStats: assembleVehicleTypeStats(vehicleResult.vtMap),
                vehicleModelStats: assembleModelStats(vehicleResult.modelMap),
                vehicleModelStatsActive: assembleModelStats(vehicleResult.modelActiveMap),
                vehicleModelStatsRetired: assembleModelStats(vehicleResult.modelRetiredMap),
                hipassRatio: { withHipass: hipassVehicleSet.size, withoutHipass: vehicleSnap.size - hipassVehicleSet.size },
                hipassTopOrgs: Object.entries(orgHipassMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
                calendarSyncRatio: { sync: vehicleResult.calendarSyncCount, notSync: vehicleResult.calendarNotSyncCount },
                calendarTopOrgs: Object.entries(vehicleResult.orgCalendarMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
                favoriteUserRatio: { total: userStats.totalUsers, withFavorite: withFavCount, rate: userStats.totalUsers > 0 ? Math.round((withFavCount / userStats.totalUsers) * 100) : 0 },
                weeklyActiveRate: { active: wauSet.size, total: userStats.totalUsers },
                monthlyGrowth, themeStats: { dark: userStats.darkCount, light: userStats.lightCount, none: userStats.noneCount },
                welcomeStats: { dismissed: userStats.welcomeDismissedCount, notDismissed: userStats.welcomeNotDismissedCount, rate: userStats.totalUsers > 0 ? Math.round((userStats.welcomeDismissedCount / userStats.totalUsers) * 100) : 0 },
                monthlyStats: { monthLabel: `${year}년 ${month + 1}월`, logs: monthLogs, distance: Math.round(monthDistance), activeUsers: monthActiveUsers.size, prevLogs, prevDistance: Math.round(prevDistance), prevActiveUsers: prevMonthActiveUsers.size },
                firstEmployeeStats: firstEmployee.stats, firstEmployeeDist: firstEmployee.dist, firstEmployeeTrend: firstEmployee.trend,
                onboardingStats: { total: totalOrgsCount, completed: onboardingCompleted, rate: totalOrgsCount > 0 ? Math.round((onboardingCompleted / totalOrgsCount) * 100) : 0 },
                orgSizeDistribution, lastUpdatedAt: new Date().toISOString(), computeDurationMs: Date.now() - startTime,
            },
            dashboardTimeSeries: {
                dailyDriveStats, dailyActiveUserStats, dailyActiveOrgStats: dailyOrgData, inputMethodStats, favoriteStats: favoriteStatsArr,
                dailyAvgDuration, hourlyStats, hourlyAvgDuration, heatmapData: { items: heatItems, maxCount: Math.max(1, ...heatItems.map(i => i.count)) },
                favoriteLogRatio: { total: favTotal, favorite: totalFav, normal: totalNorm, rate: favTotal > 0 ? Math.round((totalFav / favTotal) * 100) : 0 },
                quickDriveStats, quickDriveRatio, recommendationStats, recommendationRatio, reservationTypeStats, reservationTypeRatio,
                futureReservationTypeStats, futureReservationTypeRatio,
                lastUpdatedAt: new Date().toISOString(),
            },
            dashboardOrgRankings: {
                topOrgs, orgAvgDuration, funnelData, lastUpdatedAt: new Date().toISOString(),
            },
        };
    }

    const allStats = buildStats(null);

    // Batch Commits (Chunk size 400)
    const writeChunks: { docRef: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
    writeChunks.push({ docRef: db.doc("system/dashboardStats"), data: allStats.dashboardStats as unknown as Record<string, unknown> });
    writeChunks.push({ docRef: db.doc("system/dashboardTimeSeries"), data: allStats.dashboardTimeSeries as unknown as Record<string, unknown> });
    writeChunks.push({ docRef: db.doc("system/dashboardOrgRankings"), data: allStats.dashboardOrgRankings as unknown as Record<string, unknown> });

    // 각 승인된 기관별 캐시 생성
    const approvedOrgs = allStats.dashboardOrgRankings.topOrgs;
    for (const org of approvedOrgs) {
        const orgStats = buildStats(org.id);
        writeChunks.push({ docRef: db.doc(`system/dashboardStats_${org.id}`), data: orgStats.dashboardStats as unknown as Record<string, unknown> });
        writeChunks.push({ docRef: db.doc(`system/dashboardTimeSeries_${org.id}`), data: orgStats.dashboardTimeSeries as unknown as Record<string, unknown> });
    }

    const chunkLimit = 400;
    for (let i = 0; i < writeChunks.length; i += chunkLimit) {
        const chunk = writeChunks.slice(i, i + chunkLimit);
        const batch = db.batch();
        chunk.forEach(w => batch.set(w.docRef, w.data));
        await batch.commit();
    }

    const elapsed = Date.now() - startTime;
    console.log(`[computeDashboardStats] 완료: ${elapsed}ms, orgs=${allStats.dashboardStats.approvedOrgs}, logs=${allStats.dashboardStats.totalLogs}, users=${allStats.dashboardStats.totalUsers}, dbWrites=${writeChunks.length}`);
}
