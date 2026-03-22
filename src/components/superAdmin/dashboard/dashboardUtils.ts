/**
 * ServiceDashboard 공통 유틸리티 & 상수
 */

/* ── 상수 ── */
export const FUEL_LABELS: Record<string, string> = { gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기차' };
export const FUEL_COLORS: Record<string, string> = { gasoline: '#f59e0b', diesel: '#6366f1', lpg: '#14b8a6', electric: '#3b82f6' };
export const VT_LABELS: Record<string, string> = { compact: '경형', sedan: '승용', van: '승합', truck: '트럭', bus: '버스' };
export const VT_COLORS: Record<string, string> = { compact: '#f59e0b', sedan: '#3b82f6', van: '#8b5cf6', truck: '#ef4444', bus: '#14b8a6' };
export const ORG_PAGE_SIZE = 10;

export const NOTIF_TYPE_LABELS: Record<string, string> = {
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

export const NOTIF_TYPE_COLORS: Record<string, string> = {
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

/* ── 헬퍼 함수 ── */

export function computeDistance(data: any): number {
    if (data.distance != null && data.distance > 0) return data.distance;
    const start = parseFloat(data.startKm) || 0;
    const end = parseFloat(data.endKm) || 0;
    return end > start ? end - start : 0;
}

/** startTime, endTime ("HH:MM" 형식)으로 주행시간(분) 계산. 비정상 시 0 반환 */
export function computeDuration(startTime: any, endTime: any): number {
    if (!startTime || !endTime || typeof startTime !== 'string' || typeof endTime !== 'string') return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur <= 0) dur += 1440; // 자정 넘김 처리
    if (dur <= 0 || dur >= 1440) return 0; // 비정상 데이터 필터링
    return dur;
}

export const tooltipStyle = {
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

/* ── 타입 정의 ── */

export interface ServiceStats {
    approvedOrgs: number;
    totalUsers: number;
    adminCount: number;
    employeeCount: number;
    totalLogs: number;
    totalDistance: number;
    pendingApps: number;
}

export interface MonthlyStatsData {
    monthLabel: string;
    logs: number;
    distance: number;
    activeUsers: number;
    prevLogs: number;
    prevDistance: number;
    prevActiveUsers: number;
}

export interface OrgData {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    logs: number;
    users: number;
    vehicles: number;
    distance: number;
    lastDriveDate: Date | null;
    totalDuration: number;
    durationCount: number;
}

export interface FunnelStep {
    label: string;
    value: number;
    icon: string;
    color: string;
    gradient: string;
    rate: number;
    dropoff: number;
    conversionFromPrev: number;
}

export interface FuelStatsData {
    totalCount: number;
    totalCost: number;
    monthCount: number;
    monthCost: number;
    prevMonthCost: number;
}

export interface HipassStatsData {
    totalCount: number;
    totalAmount: number;
    monthCount: number;
    monthAmount: number;
    prevMonthAmount: number;
}

export interface NotifSummaryData {
    total: number;
    read: number;
    unread: number;
    readRate: number;
}

export interface FirstEmployeeStatsData {
    avg: number;
    median: number;
    sameDayRate: number;
    total: number;
}

export type SortKey = 'name' | 'users' | 'vehicles' | 'logs' | 'lastDriveDate';
