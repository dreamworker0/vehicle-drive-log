

export interface OrgStat {
    id: string; name: string; address: string; lat: number; lng: number;
    logs: number; users: number; vehicles: number; distance: number;
    lastDriveDate: Date | null; totalDuration: number; durationCount: number;
    [key: string]: unknown;
}

// ── 캐시 문서 타입 (system/dashboardStats) ──

export interface CachedDashboardStats {
    approvedOrgs: number;
    totalUsers: number;
    adminCount: number;
    employeeCount: number;
    totalLogs: number;
    totalDistance: number;
    pendingApps: number;
    calendarSyncOrgs: number;
    calendarSyncVehicles: number;
    calendarNotSyncVehicles: number;
    fuelTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleModelStats: { model: string; count: number }[];
    hipassRatio: { withHipass: number; withoutHipass: number };
    hipassTopOrgs: { name: string; count: number }[];
    calendarSyncRatio: { sync: number; notSync: number };
    calendarTopOrgs: { name: string; count: number }[];
    favoriteUserRatio: { total: number; withFavorite: number; rate: number };
    weeklyActiveRate: { active: number; total: number };
    monthlyGrowth: { month: string; cumulative: number }[];
    themeStats: { dark: number; light: number; none: number };
    welcomeStats?: { dismissed: number; notDismissed: number; rate: number };
    monthlyStats: {
        monthLabel: string; logs: number; distance: number; activeUsers: number;
        prevLogs: number; prevDistance: number; prevActiveUsers: number;
    };
    firstEmployeeStats: { avg: number; median: number; sameDayRate: number; total: number } | null;
    firstEmployeeDist: { label: string; count: number; color: string }[];
    firstEmployeeTrend: { month: string; avg: number }[];
    onboardingStats: { total: number; completed: number; rate: number };
    orgSizeDistribution: { label: string; count: number; color: string }[];
    lastUpdatedAt: string;
    computeDurationMs: number;
}

// ── 캐시 문서 타입 (system/dashboardTimeSeries) ──

export interface CachedDashboardTimeSeries {
    dailyDriveStats: { date: string; count: number }[];
    dailyActiveUserStats: { date: string; users: number }[];
    dailyActiveOrgStats: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[];
    inputMethodStats: { date: string; ocr: number; manual: number }[];
    favoriteStats: { date: string; favorite: number; normal: number }[];
    dailyAvgDuration: { date: string; avg: number }[];
    hourlyStats: { hour: string; count: number }[];
    hourlyAvgDuration: { hour: string; avg: number }[];
    heatmapData: { items: { dayIdx: number; hour: number; count: number }[]; maxCount: number };
    favoriteLogRatio: { total: number; favorite: number; normal: number; rate: number };
    quickDriveStats?: { date: string; regular: number; quick: number }[];
    quickDriveRatio?: { total: number; quick: number; regular: number; rate: number };
    recommendationStats?: { date: string; recommendation: number; normal: number }[];
    recommendationRatio?: { total: number; recommendation: number; normal: number; rate: number };
    reservationTypeStats?: { date: string; single: number; multiDay: number; recurring: number }[];
    reservationTypeRatio?: { total: number; single: number; multiDay: number; recurring: number; singleRate: number; multiDayRate: number; recurringRate: number };
    lastUpdatedAt: string;
}

// ── 캐시 문서 타입 (system/dashboardOrgRankings) ──

export interface CachedOrgStat {
    id: string; name: string; address: string; lat: number; lng: number;
    logs: number; users: number; vehicles: number; distance: number;
    lastDriveDate: string | null; totalDuration: number; durationCount: number;
}

export interface CachedDashboardOrgRankings {
    topOrgs: CachedOrgStat[];
    orgAvgDuration: { name: string; avg: number }[];
    funnelData: { label: string; value: number; icon: string; color: string; gradient: string; rate: number; dropoff: number; conversionFromPrev: number }[];
    lastUpdatedAt: string;
}

// Setter callback types for loadFuelHipassStats
export interface FuelHipassSetters {
    setFuelStats: React.Dispatch<React.SetStateAction<{
        totalCount: number; totalCost: number;
        monthCount: number; monthCost: number; prevMonthCost: number;
    } | null>>;
    setHipassStats: React.Dispatch<React.SetStateAction<{
        totalCount: number; totalAmount: number;
        monthCount: number; monthAmount: number; prevMonthAmount: number;
    } | null>>;
    setDailyFuelCost: React.Dispatch<React.SetStateAction<{ date: string; cost: number }[]>>;
    setDailyHipassAmount: React.Dispatch<React.SetStateAction<{ date: string; amount: number }[]>>;
}

// Setter callback types for loadNotificationStats
export interface NotificationSetters {
    setNotifSummary: React.Dispatch<React.SetStateAction<{
        total: number; read: number; unread: number; readRate: number;
    } | null>>;
    setDailyNotifStats: React.Dispatch<React.SetStateAction<{ date: string; sent: number; read: number }[]>>;
    setNotifTypeStats: React.Dispatch<React.SetStateAction<{ type: string; count: number; color: string }[]>>;
}
