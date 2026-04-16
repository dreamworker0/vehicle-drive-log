import type React from 'react';
import type { QuerySnapshot, DocumentData } from 'firebase/firestore';
import type { ServiceStats } from '../../components/superAdmin/dashboard/dashboardUtils';

export interface OrgStat {
    id: string; name: string; address: string; lat: number; lng: number;
    logs: number; users: number; vehicles: number; distance: number;
    lastDriveDate: Date | null; totalDuration: number; durationCount: number;
    [key: string]: unknown;
}

export type SharedSnaps = {
    orgSnap: QuerySnapshot<DocumentData, DocumentData>;
    userSnap: QuerySnapshot<DocumentData, DocumentData>;
    logSnap: QuerySnapshot<DocumentData, DocumentData>;
    vehicleSnap: QuerySnapshot<DocumentData, DocumentData>;
    hipassCardSnap: QuerySnapshot<DocumentData, DocumentData>;
    favoriteSnap: QuerySnapshot<DocumentData, DocumentData>;
};

// Setter callback types for processServiceStats
export interface ServiceStatsSetters {
    setStats: React.Dispatch<React.SetStateAction<ServiceStats | null>>;
    setFavoriteUserRatio: React.Dispatch<React.SetStateAction<{ total: number; withFavorite: number; rate: number }>>;
    setInputMethodStats: React.Dispatch<React.SetStateAction<{ date: string; ocr: number; manual: number }[]>>;
    setDailyDriveStats: React.Dispatch<React.SetStateAction<{ date: string; count: number }[]>>;
    setDailyActiveUserStats: React.Dispatch<React.SetStateAction<{ date: string; users: number }[]>>;
    setDailyActiveOrgStats: React.Dispatch<React.SetStateAction<{ date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[]>>;
    setHourlyStats: React.Dispatch<React.SetStateAction<{ hour: string; count: number }[]>>;
    setWeeklyActiveRate: React.Dispatch<React.SetStateAction<{ active: number; total: number }>>;
    setFavoriteStats: React.Dispatch<React.SetStateAction<{ date: string; favorite: number; normal: number }[]>>;
    setFavoriteLogRatio: React.Dispatch<React.SetStateAction<{ total: number; favorite: number; normal: number; rate: number }>>;
    setHeatmapData: React.Dispatch<React.SetStateAction<{ grid: number[][]; maxCount: number }>>;
    setDailyAvgDuration: React.Dispatch<React.SetStateAction<{ date: string; avg: number }[]>>;
    setHourlyAvgDuration: React.Dispatch<React.SetStateAction<{ hour: string; avg: number }[]>>;
}

// Setter callback types for processMonthlyStats
export interface MonthlyStatsSetters {
    setMonthlyStats: React.Dispatch<React.SetStateAction<{
        monthLabel: string; logs: number; distance: number; activeUsers: number;
        prevLogs: number; prevDistance: number; prevActiveUsers: number;
    } | null>>;
}

// Setter callback types for processTopOrganizations
export interface TopOrganizationsSetters {
    setTopOrgs: React.Dispatch<React.SetStateAction<OrgStat[]>>;
    setStats: React.Dispatch<React.SetStateAction<ServiceStats | null>>;
    setHipassRatio: React.Dispatch<React.SetStateAction<{ withHipass: number; withoutHipass: number }>>;
    setCalendarSyncRatio: React.Dispatch<React.SetStateAction<{ sync: number; notSync: number }>>;
    setHipassTopOrgs: React.Dispatch<React.SetStateAction<{ name: string; count: number }[]>>;
    setFuelTypeStats: React.Dispatch<React.SetStateAction<{ type: string; label: string; count: number; color: string }[]>>;
    setVehicleTypeStats: React.Dispatch<React.SetStateAction<{ type: string; label: string; count: number; color: string }[]>>;
    setVehicleModelStats: React.Dispatch<React.SetStateAction<{ model: string; count: number }[]>>;
    setOrgAvgDuration: React.Dispatch<React.SetStateAction<{ name: string; avg: number }[]>>;
    setMonthlyGrowth: React.Dispatch<React.SetStateAction<{ month: string; cumulative: number }[]>>;
    setFirstEmployeeStats: React.Dispatch<React.SetStateAction<{
        avg: number; median: number; sameDayRate: number; total: number;
    } | null>>;
    setFirstEmployeeDist: React.Dispatch<React.SetStateAction<{ label: string; count: number; color: string }[]>>;
    setFirstEmployeeTrend: React.Dispatch<React.SetStateAction<{ month: string; avg: number }[]>>;
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

// Setter callback types for loadQuickDriveStats
export interface QuickDriveSetters {
    setQuickDriveStats: React.Dispatch<React.SetStateAction<{ date: string; regular: number; quick: number }[]>>;
    setQuickDriveRatio: React.Dispatch<React.SetStateAction<{ total: number; quick: number; regular: number; rate: number }>>;
    setRecommendationStats: React.Dispatch<React.SetStateAction<{ date: string; recommendation: number; normal: number }[]>>;
    setRecommendationRatio: React.Dispatch<React.SetStateAction<{ total: number; recommendation: number; normal: number; rate: number }>>;
}
