import { getFirestore } from "firebase-admin/firestore";

/**
 * SuperAdmin 대시보드 통계를 배치 계산하여 system/ 문서에 캐싱.
 * 기존 6개 컬렉션 풀스캔(~35,000 reads/load)을 3건 read로 대체.
 *
 * 저장 경로:
 *   - system/dashboardStats       (카운터 & 요약)
 *   - system/dashboardTimeSeries  (30일 시계열 & 분포)
 *   - system/dashboardOrgRankings (조직별 데이터)
 */

// ── 헬퍼 ──

function computeDistance(data: FirebaseFirestore.DocumentData): number {
    if (data.distance != null && data.distance > 0) return data.distance;
    const start = parseFloat(data.startKm ?? "0") || 0;
    const end = parseFloat(data.endKm ?? "0") || 0;
    return end > start ? end - start : 0;
}

function computeDuration(startTime: unknown, endTime: unknown): number {
    if (!startTime || !endTime || typeof startTime !== "string" || typeof endTime !== "string") return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur <= 0) dur += 1440;
    if (dur <= 0 || dur >= 1440) return 0;
    return dur;
}

function toDate(ts: unknown): Date | null {
    if (!ts) return null;
    if (typeof (ts as { toDate?: unknown }).toDate === "function") {
        return (ts as { toDate: () => Date }).toDate();
    }
    if (ts instanceof Date) return ts;
    const d = new Date(ts as string | number);
    return isNaN(d.getTime()) ? null : d;
}

const FUEL_LABELS: Record<string, string> = { gasoline: "휘발유", diesel: "경유", lpg: "LPG", electric: "전기차", hydrogen: "수소차" };
const FUEL_COLORS: Record<string, string> = { gasoline: "#f59e0b", diesel: "#6366f1", lpg: "#14b8a6", electric: "#3b82f6", hydrogen: "#8b5cf6" };
const VT_LABELS: Record<string, string> = { compact: "경형", sedan: "승용", van: "승합", truck: "트럭", bus: "버스" };
const VT_COLORS: Record<string, string> = { compact: "#f59e0b", sedan: "#3b82f6", van: "#8b5cf6", truck: "#ef4444", bus: "#14b8a6" };

// ── 메인 계산 ──

export async function computeAllDashboardStats(): Promise<void> {
    const startTime = Date.now();
    const db = getFirestore();

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const thirtyDaysAgo = new Date(year, month, now.getDate() - 29);
    const thirtyDaysAgoStr = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(thirtyDaysAgo.getDate()).padStart(2, "0")}`;
    const sevenDaysAgo = new Date(year, month, now.getDate() - 6);
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
    const userByOrg: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    const logByOrg: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    const vehicleByOrg: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    const hipassByOrg: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    const reservationByOrg: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};

    userSnap.docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!userByOrg[oId]) userByOrg[oId] = [];
            userByOrg[oId].push(doc);
        }
    });
    logSnap.docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!logByOrg[oId]) logByOrg[oId] = [];
            logByOrg[oId].push(doc);
        }
    });
    vehicleSnap.docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!vehicleByOrg[oId]) vehicleByOrg[oId] = [];
            vehicleByOrg[oId].push(doc);
        }
    });
    hipassCardSnap.docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!hipassByOrg[oId]) hipassByOrg[oId] = [];
            hipassByOrg[oId].push(doc);
        }
    });
    reservationSnap.docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!reservationByOrg[oId]) reservationByOrg[oId] = [];
            reservationByOrg[oId].push(doc);
        }
    });

    function buildStats(orgFilterId: string | null) {
        // 기관 필터 유무에 따라 순회할 배열 선택 (O(1) 접근)
        const currentOrgDocs = orgFilterId ? orgSnap.docs.filter(d => d.id === orgFilterId) : orgSnap.docs;
        const currentUserDocs = orgFilterId ? (userByOrg[orgFilterId] || []) : userSnap.docs;
        const currentLogDocs = orgFilterId ? (logByOrg[orgFilterId] || []) : logSnap.docs;
        const currentVehicleDocs = orgFilterId ? (vehicleByOrg[orgFilterId] || []) : vehicleSnap.docs;
        const currentHipassDocs = orgFilterId ? (hipassByOrg[orgFilterId] || []) : hipassCardSnap.docs;
        const currentReservationDocs = orgFilterId ? (reservationByOrg[orgFilterId] || []) : reservationSnap.docs;

            // ── 2. 기관 기초 데이터 ──
        
            interface OrgInfo {
                id: string; name: string; address: string; lat: number; lng: number;
                status: string; deletedAt: unknown; createdAt: Date | null; approvedAt: Date | null;
                timeToFirstEmployeeDays: number | null;
            }
        
            const approvedOrgMap: Record<string, {
                id: string; name: string; address: string; lat: number; lng: number;
                logs: number; users: number; vehicles: number; distance: number;
                lastDriveDate: string | null; totalDuration: number; durationCount: number;
            }> = {};
        
            const allOrgList: OrgInfo[] = [];
            const approvalList: { approvedAt: Date; name: string }[] = [];
            const firstEmpDaysList: { days: number; approvedAt: Date }[] = [];
        
            currentOrgDocs.forEach(doc => {
                if (orgFilterId && doc.id !== orgFilterId) return;
                const data = doc.data();
                const createdAt = toDate(data.createdAt);
        
                allOrgList.push({
                    id: doc.id,
                    name: data.name || "이름 없음",
                    address: data.address || data.aiVerifyDetail?.address || "",
                    lat: data.lat || 0,
                    lng: data.lng || 0,
                    status: data.status as string,
                    deletedAt: data.deletedAt || null,
                    createdAt,
                    approvedAt: toDate(data.approvedAt),
                    timeToFirstEmployeeDays: data.timeToFirstEmployeeDays ?? null,
                });
        
                if (data.deletedAt || data.status !== "approved") return;
        
                approvedOrgMap[doc.id] = {
                    id: doc.id,
                    name: data.name || "이름 없음",
                    address: data.address || data.aiVerifyDetail?.address || "",
                    lat: data.lat || 0, lng: data.lng || 0,
                    logs: 0, users: 0, vehicles: 0, distance: 0,
                    lastDriveDate: null, totalDuration: 0, durationCount: 0,
                };
        
                const approvedAt = toDate(data.approvedAt);
                if (approvedAt) {
                    approvalList.push({ approvedAt, name: data.name || "이름 없음" });
                }
                if (data.timeToFirstEmployeeDays != null && approvedAt) {
                    firstEmpDaysList.push({ days: data.timeToFirstEmployeeDays, approvedAt });
                }
            });
        
            // ── 3. 유저 집계 ──
        
            let totalUsers = 0;
            let adminCount = 0;
            let employeeCount = 0;
            let darkCount = 0;
            let lightCount = 0;
            let noneCount = 0;
            let welcomeDismissedCount = 0;
            let welcomeNotDismissedCount = 0;
            const orgHasEmployee = new Set<string>();
        
            currentUserDocs.forEach(doc => {
                const data = doc.data();
                if (orgFilterId && data.organizationId !== orgFilterId) return;
                if (data.role === "superAdmin") return;
                totalUsers++;
                if (data.role === "admin") adminCount++;
                else if (data.role === "employee") employeeCount++;
                
                if (data.theme === 'dark') darkCount++;
                else if (data.theme === 'light') lightCount++;
                else noneCount++;
        
                if (data.welcomeDismissed === true) welcomeDismissedCount++;
                else welcomeNotDismissedCount++;
        
                if (data.organizationId) {
                    orgHasEmployee.add(data.organizationId);
                    if (approvedOrgMap[data.organizationId]) {
                        approvedOrgMap[data.organizationId].users++;
                    }
                }
            });
        
            // ── 4. 즐겨찾기 집계 ──
        
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
        
            let withFavCount = 0;
            currentUserDocs.forEach(doc => {
                const data = doc.data();
                if (orgFilterId && data.organizationId !== orgFilterId) return;
                if (data.role !== "superAdmin" && userFavoritesMap.has(doc.id)) withFavCount++;
            });
        
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
        
            // 월간 비교용
            let monthLogs = 0, monthDistance = 0, prevLogs = 0, prevDistance = 0;
            const monthActiveUsers = new Set<string>();
            const prevMonthActiveUsers = new Set<string>();
        
            // 30일 날짜 키 초기화 (YYYY-MM-DD)
            const dateKeys: string[] = [];
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = d.toISOString().split("T")[0]; // YYYY-MM-DD
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
        
                // 기관별 집계
                if (data.organizationId && approvedOrgMap[data.organizationId]) {
                    const org = approvedOrgMap[data.organizationId];
                    org.logs++;
                    org.distance += dist;
                    const ts = toDate(data.timestamp);
                    if (ts) {
                        if (!org.lastDriveDate || ts.toISOString() > org.lastDriveDate) {
                            org.lastDriveDate = ts.toISOString();
                        }
                    }
                    const dur = computeDuration(data.startTime, data.endTime);
                    if (dur > 0) {
                        org.totalDuration += dur;
                        org.durationCount++;
                    }
                }
        
                const ts = toDate(data.timestamp);
        
                // 월간 비교
                if (ts) {
                    if (ts.getFullYear() === year && ts.getMonth() === month) {
                        monthLogs++;
                        monthDistance += dist;
                        if (data.driverUid) monthActiveUsers.add(data.driverUid);
                    } else if (ts.getFullYear() === prevYear && ts.getMonth() === prevMonth) {
                        prevLogs++;
                        prevDistance += dist;
                        if (data.driverUid) prevMonthActiveUsers.add(data.driverUid);
                    }
                }
        
                // 30일 이내만 시계열 집계
                if (!ts || ts < thirtyDaysAgo) return;
                const dateKey = ts.toISOString().split("T")[0];
        
                if (dailyInputMap[dateKey]) {
                    if (data.inputMethod === "ocr") dailyInputMap[dateKey].ocr++;
                    else dailyInputMap[dateKey].manual++;
                }
        
                if (dailyDriveMap[dateKey] !== undefined) dailyDriveMap[dateKey]++;
        
                if (dailyActiveUserMap[dateKey] && data.driverUid) {
                    dailyActiveUserMap[dateKey].add(data.driverUid);
                }
        
                if (dailyFavoriteMap[dateKey]) {
                    const isFav = data.driverUid && data.destination &&
                        userFavoritesMap.get(data.driverUid)?.has(data.destination);
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
                        heatGrid[ts.getDay()][hourInt]++;
                    }
                }
        
                if (dur > 0 && dailyDurMap[dateKey]) dailyDurMap[dateKey].push(dur);
        
                if (ts >= sevenDaysAgo && data.driverUid) wauSet.add(data.driverUid);
            });
        
            // ── 5.5. 예약 (바로운행 및 추천) 집계 ──
        
            const dailyResMap: Record<string, { regular: number; quick: number; recommendation: number; normal: number; single: number; multiDay: number; recurring: number }> = {};
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const key = `${d.getMonth() + 1}/${d.getDate()}`;
                dailyResMap[key] = { regular: 0, quick: 0, recommendation: 0, normal: 0, single: 0, multiDay: 0, recurring: 0 };
            }
        
            let qTotal = 0, qQuick = 0, qRegular = 0;
            let recTotal = 0, recRecommendation = 0, recNormal = 0;
            let rtSingle = 0, rtMultiDay = 0, rtRecurring = 0;
        
            // 캘린더 동기화 중복 예약 방지: 동일 calendarEventId+date 조합은 1건만 집계
            const processedCalendarEvents = new Set<string>();
        
            currentReservationDocs.forEach(doc => {
                const data = doc.data();
                if (orgFilterId && data.organizationId !== orgFilterId) return;
                if (data.status === "cancelled") return;
        
                // calendarEventId 기반 중복 제거
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
                    qTotal++;
                    recTotal++;
        
                    if (data.isQuickDrive) {
                        qQuick++;
                        if (dailyResMap[key]) dailyResMap[key].quick++;
                    } else {
                        qRegular++;
                        if (dailyResMap[key]) dailyResMap[key].regular++;
                    }
        
                    if (data.source === "recommendation") {
                        recRecommendation++;
                        if (dailyResMap[key]) dailyResMap[key].recommendation++;
                    } else {
                        recNormal++;
                        if (dailyResMap[key]) dailyResMap[key].normal++;
                    }
        
                    // 예약 유형별 집계: 반복 > 다일 > 하루
                    if (data.recurringGroupId) {
                        rtRecurring++;
                        if (dailyResMap[key]) dailyResMap[key].recurring++;
                    } else if (data.groupId) {
                        rtMultiDay++;
                        if (dailyResMap[key]) dailyResMap[key].multiDay++;
                    } else {
                        rtSingle++;
                        if (dailyResMap[key]) dailyResMap[key].single++;
                    }
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
        
            // ── 6. 차량 집계 ──
        
            const fuelMap: Record<string, number> = {};
            const vtMap: Record<string, number> = {};
            const modelMap: Record<string, number> = {};
            const modelActiveMap: Record<string, number> = {};
            const modelRetiredMap: Record<string, number> = {};
            let calendarSyncCount = 0;
            let calendarNotSyncCount = 0;
            const calendarSyncOrgSet = new Set<string>();
            const orgCalendarMap: Record<string, number> = {};
        
            currentVehicleDocs.forEach(doc => {
                const data = doc.data();
                if (orgFilterId && data.organizationId !== orgFilterId) return;
                if (data.organizationId && approvedOrgMap[data.organizationId]) {
                    approvedOrgMap[data.organizationId].vehicles++;
                }
                if (data.googleCalendarId) {
                    calendarSyncCount++;
                    if (data.organizationId && approvedOrgMap[data.organizationId]) {
                        calendarSyncOrgSet.add(data.organizationId);
                        const orgName = approvedOrgMap[data.organizationId].name;
                        orgCalendarMap[orgName] = (orgCalendarMap[orgName] || 0) + 1;
                    }
                } else {
                    calendarNotSyncCount++;
                }
                const ft = (data.fuelType as string) || "gasoline";
                fuelMap[ft] = (fuelMap[ft] || 0) + 1;
                const vt = (data.vehicleType as string) || "sedan";
                vtMap[vt] = (vtMap[vt] || 0) + 1;
                const model = (data.modelName as string) || (data.displayName as string) || (data.name as string) || "알 수 없음";
                modelMap[model] = (modelMap[model] || 0) + 1;
                const isRetired = data.retired?.isRetired === true;
                if (isRetired) {
                    modelRetiredMap[model] = (modelRetiredMap[model] || 0) + 1;
                } else {
                    modelActiveMap[model] = (modelActiveMap[model] || 0) + 1;
                }
            });
        
            // ── 7. 하이패스 집계 ──
        
            const hipassVehicleSet = new Set<string>();
            const orgHipassMap: Record<string, number> = {};
            currentHipassDocs.forEach(doc => {
                const data = doc.data();
                if (orgFilterId && data.organizationId !== orgFilterId) return;
                if (data.vehicleId) hipassVehicleSet.add(data.vehicleId);
                if (data.organizationId && approvedOrgMap[data.organizationId]) {
                    const orgName = approvedOrgMap[data.organizationId].name;
                    orgHipassMap[orgName] = (orgHipassMap[orgName] || 0) + 1;
                }
            });
        
            // ── 8. 일별 기관 추이 ──
        
            const orgListFiltered = allOrgList.filter(o => o.createdAt);
            let cumActive = 0, cumInactive = 0, cumRejected = 0, cumDeleted = 0;
            orgListFiltered.forEach(o => {
                if (orgFilterId && o.id !== orgFilterId) return;
                if (!o.createdAt || o.createdAt >= thirtyDaysAgo) return;
                if (o.status === "rejected") cumRejected++;
                else if (o.deletedAt) cumDeleted++;
                else if (o.status === "approved" && orgHasEmployee.has(o.id)) cumActive++;
                else if (o.status === "approved") cumInactive++;
            });
        
            const dailyOrgData: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[] = [];
            for (let i = 0; i < 30; i++) {
                const d = new Date(thirtyDaysAgo);
                d.setDate(d.getDate() + i);
                const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
                const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
                const key = d.toISOString().split("T")[0];
        
                let dayA = 0, dayI = 0, dayR = 0, dayD = 0;
                orgListFiltered.filter(o => o.createdAt && o.createdAt >= dayStart && o.createdAt <= dayEnd).forEach(o => {
                    if (orgFilterId && o.id !== orgFilterId) return;
                    if (o.status === "rejected") { cumRejected++; dayR++; }
                    else if (o.deletedAt) { cumDeleted++; dayD++; }
                    else if (o.status === "approved" && orgHasEmployee.has(o.id)) { cumActive++; dayA++; }
                    else if (o.status === "approved") { cumInactive++; dayI++; }
                });
        
                dailyOrgData.push({ date: key, active: cumActive, inactive: cumInactive, rejected: cumRejected, deleted: cumDeleted, dayActive: dayA, dayInactive: dayI, dayRejected: dayR, dayDeleted: dayD });
            }
        
            // ── 9. 결과 조립 ──
        
            const approvedOrgs = allOrgList.filter(o => o.status === "approved").length;
            const pendingApps = pendingAppSnap.data().count;
            const totalLogs = logSnap.size;
            const hipassWithCount = hipassVehicleSet.size;
            const hipassTotalCount = vehicleSnap.size;
        
            // 월별 누적 기관 성장
            const monthGrowthMap: Record<string, number> = {};
            approvalList.sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime()).forEach(org => {
                const key = `${org.approvedAt.getFullYear()}.${(org.approvedAt.getMonth() + 1).toString().padStart(2, "0")}`;
                monthGrowthMap[key] = (monthGrowthMap[key] || 0) + 1;
            });
            const growthMonths = Object.keys(monthGrowthMap).sort();
            let cumGrowth = 0;
            const monthlyGrowth = growthMonths.map(m => {
                cumGrowth += monthGrowthMap[m];
                return { month: m, cumulative: cumGrowth };
            });
        
            // 첫 직원 등록 소요시간
            let firstEmployeeStats: { avg: number; median: number; sameDayRate: number; total: number } | null = null;
            let firstEmployeeDist: { label: string; count: number; color: string }[] = [];
            let firstEmployeeTrend: { month: string; avg: number }[] = [];
        
            if (firstEmpDaysList.length > 0) {
                const dayValues = firstEmpDaysList.map(d => d.days).sort((a, b) => a - b);
                const total = dayValues.length;
                const avg = Math.round(dayValues.reduce((s, v) => s + v, 0) / total * 10) / 10;
                const median = total % 2 === 0
                    ? (dayValues[total / 2 - 1] + dayValues[total / 2]) / 2
                    : dayValues[Math.floor(total / 2)];
                const sameDayCount = dayValues.filter(d => d === 0).length;
                firstEmployeeStats = { avg, median, sameDayRate: Math.round((sameDayCount / total) * 100), total };
        
                const buckets = [
                    { label: "당일", min: 0, max: 0, color: "#22c55e" },
                    { label: "1일", min: 1, max: 1, color: "#3b82f6" },
                    { label: "2~3일", min: 2, max: 3, color: "#6366f1" },
                    { label: "4~7일", min: 4, max: 7, color: "#8b5cf6" },
                    { label: "8~14일", min: 8, max: 14, color: "#f59e0b" },
                    { label: "15~30일", min: 15, max: 30, color: "#f97316" },
                    { label: "30일+", min: 31, max: Infinity, color: "#ef4444" },
                ];
                firstEmployeeDist = buckets.map(b => ({
                    label: b.label,
                    count: dayValues.filter(d => d >= b.min && d <= b.max).length,
                    color: b.color,
                }));
        
                const monthAvgMap: Record<string, number[]> = {};
                firstEmpDaysList.forEach(({ days, approvedAt: aDate }) => {
                    const key = `${aDate.getFullYear()}.${(aDate.getMonth() + 1).toString().padStart(2, "0")}`;
                    if (!monthAvgMap[key]) monthAvgMap[key] = [];
                    monthAvgMap[key].push(days);
                });
                firstEmployeeTrend = Object.keys(monthAvgMap).sort().map(m => ({
                    month: m,
                    avg: Math.round(monthAvgMap[m].reduce((s, v) => s + v, 0) / monthAvgMap[m].length * 10) / 10,
                }));
            }
        
            // topOrgs & 파생 데이터
            const topOrgs = Object.values(approvedOrgMap);
        
            const orgAvgDuration = topOrgs
                .filter(o => o.durationCount >= 10)
                .map(o => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
                .sort((a, b) => b.avg - a.avg)
                .slice(0, 15);
        
            // 퍼널
            const totalOrgsCount = topOrgs.length;
            const funnelSteps = totalOrgsCount > 0 ? [
                { label: "신청 기관", value: totalOrgsCount, icon: "📋", color: "#3b82f6", gradient: "from-blue-500 to-blue-600" },
                { label: "활성 기관 (직원 등록)", value: topOrgs.filter(o => o.users > 0).length, icon: "👥", color: "#8b5cf6", gradient: "from-violet-500 to-violet-600" },
                { label: "차량 등록", value: topOrgs.filter(o => o.vehicles > 0).length, icon: "🚗", color: "#f59e0b", gradient: "from-amber-500 to-amber-600" },
                { label: "주행 실행", value: topOrgs.filter(o => o.logs > 0).length, icon: "🛣️", color: "#22c55e", gradient: "from-emerald-500 to-emerald-600" },
            ] : [];
        
            const funnelData = funnelSteps.map((step, idx) => ({
                ...step,
                rate: totalOrgsCount > 0 ? Math.round((step.value / totalOrgsCount) * 100) : 0,
                dropoff: idx > 0 ? funnelSteps[idx - 1].value - step.value : 0,
                conversionFromPrev: idx > 0 && funnelSteps[idx - 1].value > 0
                    ? Math.round((step.value / funnelSteps[idx - 1].value) * 100) : 100,
            }));
        
            // 기관 규모 분포
            let small = 0, medium = 0, large = 0;
            topOrgs.forEach(org => {
                if (org.users <= 2) small++;
                else if (org.users <= 10) medium++;
                else large++;
            });
            const orgSizeDistribution = [
                { label: "소규모 (1~2명)", count: small, color: "#60a5fa" },
                { label: "중규모 (3~10명)", count: medium, color: "#34d399" },
                { label: "대규모 (11명 이상)", count: large, color: "#f59e0b" },
            ];
        
            // 온보딩 완료율
            const onboardingCompleted = topOrgs.filter(o => o.users > 0 && o.vehicles > 0 && o.logs > 0).length;
        
            // 시계열 데이터 조립 및 날짜순 정렬
            const inputMethodStats = Object.entries(dailyInputMap)
                .map(([date, counts]) => ({ date, ...counts }))
                .sort((a, b) => a.date.localeCompare(b.date));
            const dailyDriveStats = Object.entries(dailyDriveMap)
                .map(([date, count]) => ({ date, count }))
                .sort((a, b) => a.date.localeCompare(b.date));
            const dailyActiveUserStats = Object.entries(dailyActiveUserMap)
                .map(([date, uidSet]) => ({ date, users: uidSet.size }))
                .sort((a, b) => a.date.localeCompare(b.date));
            const favoriteStatsArr = Object.entries(dailyFavoriteMap)
                .map(([date, counts]) => ({ date, ...counts }))
                .sort((a, b) => a.date.localeCompare(b.date));
            const hourlyStats = Object.entries(hourMap).map(([hour, count]) => ({ hour, count }));
            const dailyAvgDuration = Object.entries(dailyDurMap)
                .map(([date, durations]) => ({
                    date,
                    avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
                }))
                .sort((a, b) => a.date.localeCompare(b.date));
            const hourlyAvgDuration = Object.entries(hourDurMap).map(([hour, durations]) => ({
                hour,
                avg: durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
            }));
        
            // favoriteLogRatio (30일 기준)
            let totalFav = 0, totalNorm = 0;
            Object.values(dailyFavoriteMap).forEach(c => { totalFav += c.favorite; totalNorm += c.normal; });
            const favTotal = totalFav + totalNorm;
        
            // heatmap
            const heatItems = heatGrid.flatMap((row, dayIdx) =>
                row.map((c, hour) => ({ dayIdx, hour, count: c })).filter(c => c.count > 0)
            );
        
        
        
            return {
                dashboardStats: {
                    approvedOrgs, totalUsers, adminCount, employeeCount, totalLogs, totalDistance: Math.round(totalDistance),
                    pendingApps: orgFilterId ? 0 : pendingAppSnap.data().count,
                    calendarSyncOrgs: calendarSyncOrgSet.size, calendarSyncVehicles: calendarSyncCount,
                    calendarNotSyncVehicles: calendarNotSyncCount,
                    fuelTypeStats: Object.entries(fuelMap).map(([type, count]) => ({ type, label: FUEL_LABELS[type] || type, count, color: FUEL_COLORS[type] || "#9ca3af" })).sort((a, b) => b.count - a.count),
                    vehicleTypeStats: Object.entries(vtMap).map(([type, count]) => ({ type, label: VT_LABELS[type] || type, count, color: VT_COLORS[type] || "#9ca3af" })).sort((a, b) => b.count - a.count),
                    vehicleModelStats: Object.entries(modelMap).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 15),
                    vehicleModelStatsActive: Object.entries(modelActiveMap).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 15),
                    vehicleModelStatsRetired: Object.entries(modelRetiredMap).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 15),
                    hipassRatio: { withHipass: hipassWithCount, withoutHipass: hipassTotalCount - hipassWithCount },
                    hipassTopOrgs: Object.entries(orgHipassMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
                    calendarSyncRatio: { sync: calendarSyncCount, notSync: calendarNotSyncCount },
                    calendarTopOrgs: Object.entries(orgCalendarMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
                    favoriteUserRatio: { total: totalUsers, withFavorite: withFavCount, rate: totalUsers > 0 ? Math.round((withFavCount / totalUsers) * 100) : 0 },
                    weeklyActiveRate: { active: wauSet.size, total: totalUsers },
                    monthlyGrowth, themeStats: { dark: darkCount, light: lightCount, none: noneCount },
                    welcomeStats: { dismissed: welcomeDismissedCount, notDismissed: welcomeNotDismissedCount, rate: totalUsers > 0 ? Math.round((welcomeDismissedCount / totalUsers) * 100) : 0 },
                    monthlyStats: { monthLabel: `${year}년 ${month + 1}월`, logs: monthLogs, distance: Math.round(monthDistance), activeUsers: monthActiveUsers.size, prevLogs, prevDistance: Math.round(prevDistance), prevActiveUsers: prevMonthActiveUsers.size },
                    firstEmployeeStats, firstEmployeeDist, firstEmployeeTrend,
                    onboardingStats: { total: totalOrgsCount, completed: onboardingCompleted, rate: totalOrgsCount > 0 ? Math.round((onboardingCompleted / totalOrgsCount) * 100) : 0 },
                    orgSizeDistribution, lastUpdatedAt: new Date().toISOString(), computeDurationMs: Date.now() - startTime
                },
                dashboardTimeSeries: {
                    dailyDriveStats, dailyActiveUserStats, dailyActiveOrgStats: dailyOrgData, inputMethodStats, favoriteStats: favoriteStatsArr,
                    dailyAvgDuration, hourlyStats, hourlyAvgDuration, heatmapData: { items: heatItems, maxCount: Math.max(1, ...heatItems.map(i => i.count)) },
                    favoriteLogRatio: { total: favTotal, favorite: totalFav, normal: totalNorm, rate: favTotal > 0 ? Math.round((totalFav / favTotal) * 100) : 0 },
                    quickDriveStats, quickDriveRatio, recommendationStats, recommendationRatio, reservationTypeStats, reservationTypeRatio,
                    lastUpdatedAt: new Date().toISOString()
                },
                dashboardOrgRankings: {
                    topOrgs, orgAvgDuration, funnelData, lastUpdatedAt: new Date().toISOString()
                }
            };
        
    }

    const allStats = buildStats(null);
    
    // Batch Commits (Chunk size 400)
    const writeChunks: {docRef: any, data: any}[] = [];
    writeChunks.push({ docRef: db.doc("system/dashboardStats"), data: allStats.dashboardStats });
    writeChunks.push({ docRef: db.doc("system/dashboardTimeSeries"), data: allStats.dashboardTimeSeries });
    writeChunks.push({ docRef: db.doc("system/dashboardOrgRankings"), data: allStats.dashboardOrgRankings });

    // 각 승인된 기관별 캐시 생성
    const approvedOrgs = allStats.dashboardOrgRankings.topOrgs;
    for (const org of approvedOrgs) {
        const orgStats = buildStats(org.id);
        writeChunks.push({ docRef: db.doc(`system/dashboardStats_${org.id}`), data: orgStats.dashboardStats });
        writeChunks.push({ docRef: db.doc(`system/dashboardTimeSeries_${org.id}`), data: orgStats.dashboardTimeSeries });
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
