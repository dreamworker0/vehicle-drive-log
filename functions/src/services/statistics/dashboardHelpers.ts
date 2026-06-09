/**
 * dashboardHelpers — 대시보드 통계 계산 공통 헬퍼 함수 및 상수
 *
 * computeDashboardStats.ts에서 분리된 유틸리티 모듈.
 */

// ── 상수 ──

export const FUEL_LABELS: Record<string, string> = {
    gasoline: "휘발유", diesel: "경유", lpg: "LPG", electric: "전기차", hydrogen: "수소차"
};
export const FUEL_COLORS: Record<string, string> = {
    gasoline: "#f59e0b", diesel: "#6366f1", lpg: "#14b8a6", electric: "#3b82f6", hydrogen: "#8b5cf6"
};
export const VT_LABELS: Record<string, string> = {
    compact: "경형", sedan: "승용", van: "승합", truck: "트럭", bus: "버스"
};
export const VT_COLORS: Record<string, string> = {
    compact: "#f59e0b", sedan: "#3b82f6", van: "#8b5cf6", truck: "#ef4444", bus: "#14b8a6"
};

export const FIRST_EMPLOYEE_BUCKETS = [
    { label: "당일", min: 0, max: 0, color: "#22c55e" },
    { label: "1일", min: 1, max: 1, color: "#3b82f6" },
    { label: "2~3일", min: 2, max: 3, color: "#6366f1" },
    { label: "4~7일", min: 4, max: 7, color: "#8b5cf6" },
    { label: "8~14일", min: 8, max: 14, color: "#f59e0b" },
    { label: "15~30일", min: 15, max: 30, color: "#f97316" },
    { label: "30일+", min: 31, max: Infinity, color: "#ef4444" },
];

// ── 헬퍼 함수 ──

export function computeDistance(data: FirebaseFirestore.DocumentData): number {
    if (data.distance != null && data.distance > 0) return data.distance;
    const start = parseFloat(data.startKm ?? "0") || 0;
    const end = parseFloat(data.endKm ?? "0") || 0;
    return end > start ? end - start : 0;
}

export function computeDuration(startTime: unknown, endTime: unknown): number {
    if (!startTime || !endTime || typeof startTime !== "string" || typeof endTime !== "string") return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    let dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur <= 0) dur += 1440;
    if (dur <= 0 || dur >= 1440) return 0;
    return dur;
}

export function toDate(ts: unknown): Date | null {
    if (!ts) return null;
    if (typeof (ts as { toDate?: unknown }).toDate === "function") {
        return (ts as { toDate: () => Date }).toDate();
    }
    if (ts instanceof Date) return ts;
    const d = new Date(ts as string | number);
    return isNaN(d.getTime()) ? null : d;
}

// ── 공유 타입 ──

export interface OrgInfo {
    id: string; name: string; address: string; lat: number; lng: number;
    status: string; deletedAt: unknown; createdAt: Date | null; approvedAt: Date | null;
    timeToFirstEmployeeDays: number | null;
}

export interface ApprovedOrgData {
    id: string; name: string; address: string; lat: number; lng: number;
    logs: number; users: number; vehicles: number; distance: number;
    lastDriveDate: string | null; totalDuration: number; durationCount: number;
}

export interface BuildStatsContext {
    orgFilterId: string | null;
    startTime: number;
    now: Date;
    year: number;
    month: number;
    thirtyDaysAgo: Date;
    sevenDaysAgo: Date;
    prevMonth: number;
    prevYear: number;
    // 사전 분류된 문서 집합
    orgDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    userDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    logDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    vehicleDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    hipassDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    reservationDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    favoriteSnap: FirebaseFirestore.QuerySnapshot;
    pendingAppSnap: FirebaseFirestore.AggregateQuerySnapshot<{ count: FirebaseFirestore.AggregateField<number> }>;
    logSnapSize: number;
    vehicleSnapSize: number;
}

/**
 * 문서 배열을 organizationId 기준으로 그룹화
 */
export function groupByOrg(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> {
    const map: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    docs.forEach(doc => {
        const oId = doc.data().organizationId;
        if (oId) {
            if (!map[oId]) map[oId] = [];
            map[oId].push(doc);
        }
    });
    return map;
}
