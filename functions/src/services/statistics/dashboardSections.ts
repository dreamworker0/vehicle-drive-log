/**
 * dashboardSections — buildStats 내부의 섹션별 집계 로직
 *
 * computeDashboardStats.ts에서 분리된 섹션별 집계 함수.
 * 각 함수는 순수 계산 함수로, Firestore 호출 없이 문서 데이터만 처리합니다.
 */

import {
    toDate,
    FUEL_LABELS, FUEL_COLORS, VT_LABELS, VT_COLORS,
    FIRST_EMPLOYEE_BUCKETS,
    type OrgInfo, type ApprovedOrgData,
} from "./dashboardHelpers";
import { getKSTDateString } from "../../utils/kstDate";

// ── 2. 기관 기초 데이터 ──

interface OrgBaseResult {
    approvedOrgMap: Record<string, ApprovedOrgData>;
    allOrgList: OrgInfo[];
    approvalList: { approvedAt: Date; name: string }[];
    firstEmpDaysList: { days: number; approvedAt: Date }[];
}

export function computeOrgBase(
    orgDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    orgFilterId: string | null,
): OrgBaseResult {
    const approvedOrgMap: Record<string, ApprovedOrgData> = {};
    const allOrgList: OrgInfo[] = [];
    const approvalList: { approvedAt: Date; name: string }[] = [];
    const firstEmpDaysList: { days: number; approvedAt: Date }[] = [];

    orgDocs.forEach(doc => {
        if (orgFilterId && doc.id !== orgFilterId) return;
        const data = doc.data();
        const createdAt = toDate(data.createdAt);

        allOrgList.push({
            id: doc.id,
            name: data.name || "이름 없음",
            address: data.address || data.aiVerifyDetail?.address || "",
            lat: data.lat || 0, lng: data.lng || 0,
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

    return { approvedOrgMap, allOrgList, approvalList, firstEmpDaysList };
}

// ── 3. 유저 집계 ──

export interface UserStatsResult {
    totalUsers: number; adminCount: number; employeeCount: number;
    darkCount: number; lightCount: number; noneCount: number;
    welcomeDismissedCount: number; welcomeNotDismissedCount: number;
    orgHasEmployee: Set<string>;
}

export function computeUserStats(
    userDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    approvedOrgMap: Record<string, ApprovedOrgData>,
    orgFilterId: string | null,
): UserStatsResult {
    let totalUsers = 0, adminCount = 0, employeeCount = 0;
    let darkCount = 0, lightCount = 0, noneCount = 0;
    let welcomeDismissedCount = 0, welcomeNotDismissedCount = 0;
    const orgHasEmployee = new Set<string>();

    userDocs.forEach(doc => {
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

    return { totalUsers, adminCount, employeeCount, darkCount, lightCount, noneCount, welcomeDismissedCount, welcomeNotDismissedCount, orgHasEmployee };
}

// ── 4. 즐겨찾기 집계 ──

export function computeFavoriteUsers(
    favoriteSnap: FirebaseFirestore.QuerySnapshot,
    userDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    orgFilterId: string | null,
): { userFavoritesMap: Map<string, Set<string>>; withFavCount: number } {
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
    userDocs.forEach(doc => {
        const data = doc.data();
        if (orgFilterId && data.organizationId !== orgFilterId) return;
        if (data.role !== "superAdmin" && userFavoritesMap.has(doc.id)) withFavCount++;
    });

    return { userFavoritesMap, withFavCount };
}

// ── 6. 차량 집계 ──

export interface VehicleStatsResult {
    fuelMap: Record<string, number>; vtMap: Record<string, number>;
    modelMap: Record<string, number>; modelActiveMap: Record<string, number>;
    modelRetiredMap: Record<string, number>;
    calendarSyncCount: number; calendarNotSyncCount: number;
    calendarSyncOrgSet: Set<string>; orgCalendarMap: Record<string, number>;
}

export function computeVehicleStats(
    vehicleDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    approvedOrgMap: Record<string, ApprovedOrgData>,
    orgFilterId: string | null,
): VehicleStatsResult {
    const fuelMap: Record<string, number> = {};
    const vtMap: Record<string, number> = {};
    const modelMap: Record<string, number> = {};
    const modelActiveMap: Record<string, number> = {};
    const modelRetiredMap: Record<string, number> = {};
    let calendarSyncCount = 0, calendarNotSyncCount = 0;
    const calendarSyncOrgSet = new Set<string>();
    const orgCalendarMap: Record<string, number> = {};

    vehicleDocs.forEach(doc => {
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
        if (isRetired) modelRetiredMap[model] = (modelRetiredMap[model] || 0) + 1;
        else modelActiveMap[model] = (modelActiveMap[model] || 0) + 1;
    });

    return { fuelMap, vtMap, modelMap, modelActiveMap, modelRetiredMap, calendarSyncCount, calendarNotSyncCount, calendarSyncOrgSet, orgCalendarMap };
}

// ── 7. 하이패스 집계 ──

export function computeHipassStats(
    hipassDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    approvedOrgMap: Record<string, ApprovedOrgData>,
    orgFilterId: string | null,
): { hipassVehicleSet: Set<string>; orgHipassMap: Record<string, number> } {
    const hipassVehicleSet = new Set<string>();
    const orgHipassMap: Record<string, number> = {};

    hipassDocs.forEach(doc => {
        const data = doc.data();
        if (orgFilterId && data.organizationId !== orgFilterId) return;
        if (data.vehicleId) hipassVehicleSet.add(data.vehicleId);
        if (data.organizationId && approvedOrgMap[data.organizationId]) {
            const orgName = approvedOrgMap[data.organizationId].name;
            orgHipassMap[orgName] = (orgHipassMap[orgName] || 0) + 1;
        }
    });

    return { hipassVehicleSet, orgHipassMap };
}

// ── 9. 결과 조립 헬퍼 ──

export function computeFirstEmployeeAnalysis(firstEmpDaysList: { days: number; approvedAt: Date }[]) {
    if (firstEmpDaysList.length === 0) {
        return { stats: null, dist: [] as { label: string; count: number; color: string }[], trend: [] as { month: string; avg: number }[] };
    }

    const dayValues = firstEmpDaysList.map(d => d.days).sort((a, b) => a - b);
    const total = dayValues.length;
    const avg = Math.round(dayValues.reduce((s, v) => s + v, 0) / total * 10) / 10;
    const median = total % 2 === 0
        ? (dayValues[total / 2 - 1] + dayValues[total / 2]) / 2
        : dayValues[Math.floor(total / 2)];
    const sameDayCount = dayValues.filter(d => d === 0).length;
    const stats = { avg, median, sameDayRate: Math.round((sameDayCount / total) * 100), total };

    const dist = FIRST_EMPLOYEE_BUCKETS.map(b => ({
        label: b.label,
        count: dayValues.filter(d => d >= b.min && d <= b.max).length,
        color: b.color,
    }));

    const monthAvgMap: Record<string, number[]> = {};
    firstEmpDaysList.forEach(({ days, approvedAt }) => {
        const key = `${approvedAt.getFullYear()}.${(approvedAt.getMonth() + 1).toString().padStart(2, "0")}`;
        if (!monthAvgMap[key]) monthAvgMap[key] = [];
        monthAvgMap[key].push(days);
    });
    const trend = Object.keys(monthAvgMap).sort().map(m => ({
        month: m,
        avg: Math.round(monthAvgMap[m].reduce((s, v) => s + v, 0) / monthAvgMap[m].length * 10) / 10,
    }));

    return { stats, dist, trend };
}

export function computeMonthlyGrowth(approvalList: { approvedAt: Date; name: string }[]) {
    const monthGrowthMap: Record<string, number> = {};
    approvalList.sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime()).forEach(org => {
        const key = `${org.approvedAt.getFullYear()}.${(org.approvedAt.getMonth() + 1).toString().padStart(2, "0")}`;
        monthGrowthMap[key] = (monthGrowthMap[key] || 0) + 1;
    });
    const growthMonths = Object.keys(monthGrowthMap).sort();
    let cumGrowth = 0;
    return growthMonths.map(m => {
        cumGrowth += monthGrowthMap[m];
        return { month: m, cumulative: cumGrowth };
    });
}

export function computeFunnelData(topOrgs: ApprovedOrgData[]) {
    const totalOrgsCount = topOrgs.length;
    if (totalOrgsCount === 0) return [];

    const funnelSteps = [
        { label: "신청 기관", value: totalOrgsCount, icon: "📋", color: "#3b82f6", gradient: "from-blue-500 to-blue-600" },
        { label: "활성 기관 (직원 등록)", value: topOrgs.filter(o => o.users > 0).length, icon: "👥", color: "#8b5cf6", gradient: "from-violet-500 to-violet-600" },
        { label: "차량 등록", value: topOrgs.filter(o => o.vehicles > 0).length, icon: "🚗", color: "#f59e0b", gradient: "from-amber-500 to-amber-600" },
        { label: "주행 실행", value: topOrgs.filter(o => o.logs > 0).length, icon: "🛣️", color: "#22c55e", gradient: "from-emerald-500 to-emerald-600" },
    ];

    return funnelSteps.map((step, idx) => ({
        ...step,
        rate: Math.round((step.value / totalOrgsCount) * 100),
        dropoff: idx > 0 ? funnelSteps[idx - 1].value - step.value : 0,
        conversionFromPrev: idx > 0 && funnelSteps[idx - 1].value > 0
            ? Math.round((step.value / funnelSteps[idx - 1].value) * 100) : 100,
    }));
}

export function computeOrgSizeDistribution(topOrgs: ApprovedOrgData[]) {
    let small = 0, medium = 0, large = 0;
    topOrgs.forEach(org => {
        if (org.users <= 2) small++;
        else if (org.users <= 10) medium++;
        else large++;
    });
    return [
        { label: "소규모 (1~2명)", count: small, color: "#60a5fa" },
        { label: "중규모 (3~10명)", count: medium, color: "#34d399" },
        { label: "대규모 (11명 이상)", count: large, color: "#f59e0b" },
    ];
}

// ── 차량 통계 조립 헬퍼 ──

export function assembleFuelTypeStats(fuelMap: Record<string, number>) {
    return Object.entries(fuelMap)
        .map(([type, count]) => ({ type, label: FUEL_LABELS[type] || type, count, color: FUEL_COLORS[type] || "#9ca3af" }))
        .sort((a, b) => b.count - a.count);
}

export function assembleVehicleTypeStats(vtMap: Record<string, number>) {
    return Object.entries(vtMap)
        .map(([type, count]) => ({ type, label: VT_LABELS[type] || type, count, color: VT_COLORS[type] || "#9ca3af" }))
        .sort((a, b) => b.count - a.count);
}

export function assembleModelStats(modelMap: Record<string, number>, limit = 15) {
    return Object.entries(modelMap)
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

// ── 5.5. 예약 집계 ──

interface ReservationTypeRatio {
    total: number; single: number; multiDay: number; recurring: number;
    singleRate: number; multiDayRate: number; recurringRate: number;
}

export interface ReservationStatsResult {
    quickDriveRatio: { total: number; quick: number; regular: number; rate: number };
    quickDriveStats: { date: string; regular: number; quick: number }[];
    recommendationRatio: { total: number; recommendation: number; normal: number; rate: number };
    recommendationStats: { date: string; recommendation: number; normal: number }[];
    reservationTypeRatio: ReservationTypeRatio;
    reservationTypeStats: { date: string; single: number; multiDay: number; recurring: number }[];
    futureReservationTypeRatio: ReservationTypeRatio;
    futureReservationTypeStats: { date: string; single: number; multiDay: number; recurring: number }[];
}

/**
 * 예약 집계 — 빠른배차/추천/예약유형 비율과 30일 시계열, 미래 30일 예약유형 분포 계산.
 *
 * 입력 Date(thirtyDaysAgo, todayStart)와 year/month/kstNow는 호출자가 준비한 값을
 * 그대로 사용한다(이 함수는 추가 KST 변환을 하지 않는다). calendarEventId 중복 예약은
 * 함수 내부에서 (calendarEventId+date) 키로 1회만 집계한다.
 */
export function computeReservationStats(
    reservationDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    thirtyDaysAgo: Date,
    todayStart: Date,
    orgFilterId: string | null,
): ReservationStatsResult {
    // thirtyDaysAgo는 호출자가 Date.now() 기준으로 만들어 시각(시/분/초)이 실려 있을 수 있다.
    // 아래 비교 대상 parsed는 new Date(y, m-1, dd)로 자정이므로, 시각을 0으로 정규화하지 않으면
    // 윈도우 첫날(=thirtyDaysAgo와 같은 날짜)의 예약이 parsed >= thirtyDaysAgo에서 누락된다.
    const startOfThirtyDaysAgo = new Date(thirtyDaysAgo.getFullYear(), thirtyDaysAgo.getMonth(), thirtyDaysAgo.getDate());
    const dailyResMap: Record<string, { regular: number; quick: number; recommendation: number; normal: number; single: number; multiDay: number; recurring: number }> = {};
    for (let i = 0; i < 30; i++) {
        const d = new Date(startOfThirtyDaysAgo);
        d.setDate(d.getDate() + i);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        dailyResMap[key] = { regular: 0, quick: 0, recommendation: 0, normal: 0, single: 0, multiDay: 0, recurring: 0 };
    }

    const futureResMap: Record<string, { single: number; multiDay: number; recurring: number }> = {};
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

    reservationDocs.forEach(doc => {
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

        if (parsed >= startOfThirtyDaysAgo) {
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

    return {
        quickDriveRatio, quickDriveStats,
        recommendationRatio, recommendationStats,
        reservationTypeRatio, reservationTypeStats,
        futureReservationTypeRatio, futureReservationTypeStats,
    };
}

// ── 10. 주유/하이패스 일별 집계 (ALL 스코프 캐시 이관) ──

/** thirtyDaysAgoStr('YYYY-MM-DD')에서 파생한 로컬 자정 앵커 + 30일 'M/D' 키 맵 생성 */
function buildDailyKeyMap<T>(thirtyDaysAgoStr: string, init: () => T): { anchor: Date; map: Record<string, T> } {
    const [y, m, d] = thirtyDaysAgoStr.split("-").map(Number);
    const anchor = new Date(y, m - 1, d);
    const map: Record<string, T> = {};
    for (let i = 0; i < 30; i++) {
        const cur = new Date(anchor);
        cur.setDate(cur.getDate() + i);
        map[`${cur.getMonth() + 1}/${cur.getDate()}`] = init();
    }
    return { anchor, map };
}

export interface FuelHipassDailyResult {
    dailyFuelCost: { date: string; cost: number }[];
    dailyHipassAmount: { date: string; amount: number }[];
}

/**
 * 주유/하이패스 일별 비용 시계열 (최근 30일, 'M/D' 키).
 * thirtyDaysAgoStr는 KST 기준 윈도우 시작일(포함) — date 필드가 'YYYY-MM-DD' 문자열이라
 * date-only 달력 연산만 하므로 UTC 런타임에서도 클라이언트(loadFuelHipassStats)와 키가 일치한다.
 */
export function computeFuelHipassDaily(
    fuelDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    hipassDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    thirtyDaysAgoStr: string,
    orgFilterId: string | null,
): FuelHipassDailyResult {
    const { anchor, map: fuelDailyMap } = buildDailyKeyMap(thirtyDaysAgoStr, () => 0);
    const { map: hipassDailyMap } = buildDailyKeyMap(thirtyDaysAgoStr, () => 0);

    const accumulate = (docs: FirebaseFirestore.QueryDocumentSnapshot[], map: Record<string, number>, field: string) => {
        docs.forEach(doc => {
            const data = doc.data();
            if (orgFilterId && data.organizationId !== orgFilterId) return;
            const dateStr = data.date as string;
            if (!dateStr) return;
            const [y, m, dd] = dateStr.split("-").map(Number);
            const parsed = new Date(y, m - 1, dd);
            if (!(parsed >= anchor)) return; // NaN(비정상 date)도 함께 배제
            const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
            if (map[key] !== undefined) map[key] += (data[field] || 0);
        });
    };
    accumulate(fuelDocs, fuelDailyMap, "fuelCost");
    accumulate(hipassDocs, hipassDailyMap, "chargeAmount");

    return {
        dailyFuelCost: Object.entries(fuelDailyMap).map(([date, cost]) => ({ date, cost })),
        dailyHipassAmount: Object.entries(hipassDailyMap).map(([date, amount]) => ({ date, amount })),
    };
}

// ── 11. 알림 집계 (ALL 스코프 캐시 이관) ──

export interface NotificationStatsResult {
    notifSummary: { total: number; read: number; unread: number; readRate: number };
    dailyNotifStats: { date: string; sent: number; read: number }[];
    /** 원시 type 키 — 한글 라벨/색상 매핑은 클라이언트(dashboardUtils.mapNotifTypeCounts) 관심사 */
    notifTypeCounts: { type: string; count: number }[];
}

/**
 * 알림 요약·일별·타입별 집계 (최근 30일, 'M/D' 키).
 * totals(전체/읽음 수)는 호출자가 count 집계쿼리로 구해 주입한다(원본 전체 스캔 방지).
 * createdAt은 Timestamp라 getKSTDateString으로 KST 날짜에 버킷팅 — loadNotificationStats와 패리티.
 */
export function computeNotificationStats(
    notifDocs: FirebaseFirestore.QueryDocumentSnapshot[],
    totals: { total: number; read: number },
    thirtyDaysAgoStr: string,
    orgFilterId: string | null,
): NotificationStatsResult {
    const { map: dailyMap } = buildDailyKeyMap(thirtyDaysAgoStr, () => ({ sent: 0, read: 0 }));
    const typeMap: Record<string, number> = {};

    notifDocs.forEach(doc => {
        const data = doc.data();
        if (orgFilterId && data.organizationId !== orgFilterId) return;

        const t = (data.type as string) || "system";
        typeMap[t] = (typeMap[t] || 0) + 1;

        const ts = toDate(data.createdAt);
        if (!ts) return;
        const kstStr = getKSTDateString(ts);
        if (kstStr < thirtyDaysAgoStr) return;
        const [, m, dd] = kstStr.split("-").map(Number);
        const key = `${m}/${dd}`;
        if (dailyMap[key]) {
            dailyMap[key].sent++;
            if (data.read) dailyMap[key].read++;
        }
    });

    const { total, read } = totals;
    return {
        notifSummary: {
            total, read,
            unread: total - read,
            readRate: total > 0 ? Math.round((read / total) * 100) : 0,
        },
        dailyNotifStats: Object.entries(dailyMap).map(([date, counts]) => ({ date, ...counts })),
        notifTypeCounts: Object.entries(typeMap)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count),
    };
}
