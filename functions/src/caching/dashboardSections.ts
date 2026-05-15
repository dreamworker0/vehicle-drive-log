/**
 * dashboardSections — buildStats 내부의 섹션별 집계 로직
 *
 * computeDashboardStats.ts에서 분리된 섹션별 집계 함수.
 * 각 함수는 순수 계산 함수로, Firestore 호출 없이 문서 데이터만 처리합니다.
 */

import {
    computeDistance, computeDuration, toDate,
    FUEL_LABELS, FUEL_COLORS, VT_LABELS, VT_COLORS,
    FIRST_EMPLOYEE_BUCKETS,
    type OrgInfo, type ApprovedOrgData,
} from "./dashboardHelpers";

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
