import type { ServiceStats } from './dashboardUtils';

/* ── 통계 카드 ── */
interface StatCardProps {
    label: string;
    value: string | number;
    unit: string;
    icon: string;
    color: string;
    sub?: string | null;
}

function StatCard({ label, value, unit, icon, color, sub }: StatCardProps) {
    const colorMap: Record<string, string> = {
        blue: 'from-blue-50 to-blue-100 border-blue-200 dark:from-blue-950/50 dark:to-blue-900/30 dark:border-blue-800/50',
        green: 'from-emerald-50 to-emerald-100 border-emerald-200 dark:from-emerald-950/50 dark:to-emerald-900/30 dark:border-emerald-800/50',
        purple: 'from-purple-50 to-purple-100 border-purple-200 dark:from-purple-950/50 dark:to-purple-900/30 dark:border-purple-800/50',
        orange: 'from-orange-50 to-orange-100 border-orange-200 dark:from-orange-950/50 dark:to-orange-900/30 dark:border-orange-800/50',
    };

    return (
        <div className={`rounded-2xl border p-4 bg-gradient-to-br ${colorMap[color] || colorMap.blue}`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{label}</span>
                <span className="text-lg">{icon}</span>
            </div>
            <p className="text-2xl font-bold text-surface-800 dark:text-surface-100">
                {value}<span className="text-sm font-normal text-surface-400 dark:text-surface-400 ml-1">{unit}</span>
            </p>
            {sub && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{sub}</p>}
        </div>
    );
}

/* ── 서비스 개요 카드 ── */
interface Props {
    stats: ServiceStats;
}

export default function DashboardOverviewCards({ stats }: Props) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                label="신청 기관"
                value={stats.approvedOrgs}
                unit="개"
                icon="🏢"
                color="blue"
                sub={[
                    stats.pendingApps > 0 ? `대기 ${stats.pendingApps}건` : null,
                    stats.calendarSyncOrgs > 0 ? `연동 ${stats.calendarSyncOrgs}곳` : null
                ].filter(Boolean).join(' · ') || null}
            />
            <StatCard
                label="전체 사용자"
                value={stats.totalUsers}
                unit="명"
                icon="👤"
                color="green"
                sub={`관리자 ${stats.adminCount} · 직원 ${stats.employeeCount}`}
            />
            <StatCard label="총 운행" value={stats.totalLogs.toLocaleString()} unit="회" icon="📊" color="purple" />
            <StatCard
                label="총 주행거리"
                value={stats.totalDistance.toLocaleString()}
                unit="km"
                icon="🛣️"
                color="orange"
            />
        </div>
    );
}
