import { getFirestore, AggregateField } from "firebase-admin/firestore";
import {
    computeDistance, computeDuration, toDate, groupByOrg,
} from "./dashboardHelpers";
import { toKSTDate, getKSTDateString, getKSTDayOfWeek } from "../../utils/kstDate";
import {
    computeOrgBase, computeUserStats, computeFavoriteUsers,
    computeVehicleStats, computeHipassStats,
    computeFirstEmployeeAnalysis, computeMonthlyGrowth,
    computeFunnelData, computeOrgSizeDistribution,
    assembleFuelTypeStats, assembleVehicleTypeStats, assembleModelStats,
    computeReservationStats,
    computeFuelHipassDaily, computeNotificationStats,
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
    const thirtyDaysAgoStr = getKSTDateString(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
    // KST 날짜 문자열에서 파생한 앵커/인스턴트 — UTC 런타임에서 로컬(=UTC) 날짜 파트로 키를 만들면
    // 야간 배치(02:00 KST = 전일 17:00 UTC) 실행 시 일별 차트가 하루 밀리는 스큐가 생긴다.
    const [tdY, tdM, tdD] = thirtyDaysAgoStr.split("-").map(Number);
    const thirtyDaysAgo = new Date(tdY, tdM - 1, tdD); // 날짜 키 생성용 달력 앵커 (KST 날짜 파트)
    const thirtyDaysAgoInstant = new Date(`${thirtyDaysAgoStr}T00:00:00+09:00`); // Timestamp 비교용 정확한 KST 자정 인스턴트
    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    // 전달 1일: 현재월·전월 비교 통계를 커버하는 최소 범위 (~45일)
    const prevMonthStart = new Date(prevYear, prevMonth, 1);
    // 당월/전월 경계 (date 문자열 비교용 — loadFuelHipassStats와 동일 규약)
    const curMonthStartStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const curMonthEndStr = `${year}-${String(month + 1).padStart(2, "0")}-31`;
    const prevMonthStartStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-01`;
    const prevMonthEndStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-31`;

    // 1. 컬렉션 병렬 조회 (driveLogs는 count + 최근 필터로 분리)
    const fuelCol = db.collection("fuelLogs");
    const hipassChargeCol = db.collection("hipassCharges");
    const notifCol = db.collection("notifications");
    const [
        orgSnap, userSnap, logCountSnap, recentLogSnap, vehicleSnap, hipassCardSnap, favoriteSnap, pendingAppSnap, reservationSnap,
        // ALL 스코프 캐시 이관: 주유/하이패스/알림 — 30일 원본 + 요약 집계쿼리 (열람 시 라이브 스캔 대체)
        fuelRecentSnap, hipassRecentSnap, notifRecentSnap,
        fuelAllAgg, hipassAllAgg, fuelMonthAgg, hipassMonthAgg, fuelPrevMonthAgg, hipassPrevMonthAgg,
        notifTotalAgg, notifReadAgg,
    ] = await Promise.all([
        db.collection("organizations").get(),
        db.collection("users").get(),
        db.collection("driveLogs").count().get(),
        db.collection("driveLogs").where("timestamp", ">=", prevMonthStart).get(),
        db.collection("vehicles").get(),
        db.collection("hipassCards").get(),
        db.collection("favorites").get(),
        db.collection("orgApplications").where("status", "==", "pending").count().get(),
        db.collection("reservations").where("date", ">=", thirtyDaysAgoStr).get(),
        fuelCol.where("date", ">=", thirtyDaysAgoStr).get(),
        hipassChargeCol.where("date", ">=", thirtyDaysAgoStr).get(),
        notifCol.where("createdAt", ">=", thirtyDaysAgoInstant).get(),
        fuelCol.aggregate({ totalCount: AggregateField.count(), totalCost: AggregateField.sum("fuelCost") }).get(),
        hipassChargeCol.aggregate({ totalCount: AggregateField.count(), totalAmount: AggregateField.sum("chargeAmount") }).get(),
        fuelCol.where("date", ">=", curMonthStartStr).where("date", "<=", curMonthEndStr)
            .aggregate({ monthCount: AggregateField.count(), monthCost: AggregateField.sum("fuelCost") }).get(),
        hipassChargeCol.where("date", ">=", curMonthStartStr).where("date", "<=", curMonthEndStr)
            .aggregate({ monthCount: AggregateField.count(), monthAmount: AggregateField.sum("chargeAmount") }).get(),
        fuelCol.where("date", ">=", prevMonthStartStr).where("date", "<=", prevMonthEndStr)
            .aggregate({ prevCost: AggregateField.sum("fuelCost") }).get(),
        hipassChargeCol.where("date", ">=", prevMonthStartStr).where("date", "<=", prevMonthEndStr)
            .aggregate({ prevAmount: AggregateField.sum("chargeAmount") }).get(),
        notifCol.count().get(),
        notifCol.where("read", "==", true).count().get(),
    ]);

    // 1.5. 사전 분류 (O(N+M) 최적화를 위해 기관별로 문서 분배)
    const userByOrg = groupByOrg(userSnap.docs);
    const logByOrg = groupByOrg(recentLogSnap.docs);
    const vehicleByOrg = groupByOrg(vehicleSnap.docs);
    const hipassByOrg = groupByOrg(hipassCardSnap.docs);
    const reservationByOrg = groupByOrg(reservationSnap.docs);

    function buildStats(orgFilterId: string | null) {
        // 기관 필터 유무에 따라 순회할 배열 선택
        const currentOrgDocs = orgFilterId ? orgSnap.docs.filter(d => d.id === orgFilterId) : orgSnap.docs;
        const currentUserDocs = orgFilterId ? (userByOrg[orgFilterId] || []) : userSnap.docs;
        const currentLogDocs = orgFilterId ? (logByOrg[orgFilterId] || []) : recentLogSnap.docs;
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

            if (!ts || ts < thirtyDaysAgoInstant) return;
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
        const todayStart = new Date(year, month, kstNow.getDate());
        const {
            quickDriveRatio, quickDriveStats,
            recommendationRatio, recommendationStats,
            reservationTypeRatio, reservationTypeStats,
            futureReservationTypeRatio, futureReservationTypeStats,
        } = computeReservationStats(currentReservationDocs, thirtyDaysAgo, todayStart, orgFilterId);

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
                totalLogs: logCountSnap.data().count, totalDistance: Math.round(totalDistance),
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

    // ── ALL 스코프 전용: 주유/하이패스/알림 사전집계 (기관별 변형 문서에는 넣지 않음 — 기관 필터는 라이브 로더 유지) ──
    const { dailyFuelCost, dailyHipassAmount } = computeFuelHipassDaily(fuelRecentSnap.docs, hipassRecentSnap.docs, thirtyDaysAgoStr, null);
    const { notifSummary, dailyNotifStats, notifTypeCounts } = computeNotificationStats(
        notifRecentSnap.docs,
        { total: notifTotalAgg.data().count, read: notifReadAgg.data().count },
        thirtyDaysAgoStr,
        null,
    );
    const fuelStats = {
        totalCount: fuelAllAgg.data().totalCount,
        totalCost: fuelAllAgg.data().totalCost ?? 0,
        monthCount: fuelMonthAgg.data().monthCount,
        monthCost: fuelMonthAgg.data().monthCost ?? 0,
        prevMonthCost: fuelPrevMonthAgg.data().prevCost ?? 0,
    };
    const hipassStats = {
        totalCount: hipassAllAgg.data().totalCount,
        totalAmount: hipassAllAgg.data().totalAmount ?? 0,
        monthCount: hipassMonthAgg.data().monthCount,
        monthAmount: hipassMonthAgg.data().monthAmount ?? 0,
        prevMonthAmount: hipassPrevMonthAgg.data().prevAmount ?? 0,
    };

    // Batch Commits (Chunk size 400)
    const writeChunks: { docRef: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
    writeChunks.push({ docRef: db.doc("system/dashboardStats"), data: { ...allStats.dashboardStats, fuelStats, hipassStats, notifSummary } as unknown as Record<string, unknown> });
    writeChunks.push({ docRef: db.doc("system/dashboardTimeSeries"), data: { ...allStats.dashboardTimeSeries, dailyFuelCost, dailyHipassAmount, dailyNotifStats, notifTypeCounts } as unknown as Record<string, unknown> });
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
    console.log(`[computeDashboardStats] 완료: ${elapsed}ms, orgs=${allStats.dashboardStats.approvedOrgs}, logs=${allStats.dashboardStats.totalLogs}(count), recentLogs=${recentLogSnap.size}, users=${allStats.dashboardStats.totalUsers}, fuelDocs=${fuelRecentSnap.size}, hipassDocs=${hipassRecentSnap.size}, notifDocs=${notifRecentSnap.size}, dbWrites=${writeChunks.length}`);
}
