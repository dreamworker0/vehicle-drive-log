import type { MonthlyStatsData } from './dashboardUtils';

/* ── 월간 지표 카드 (전월 대비) ── */
interface MonthlyMetricProps {
    label: string;
    value: number;
    prev: number;
    unit?: string;
    color: string;
}

function MonthlyMetric({ label, value, prev, unit, color }: MonthlyMetricProps) {
    const diff = prev > 0 ? Math.round(((value - prev) / prev) * 100) : (value > 0 ? 100 : 0);
    const colorClass: Record<string, string> = {
        primary: 'text-primary-600 dark:text-primary-400',
        emerald: 'text-emerald-600 dark:text-emerald-400',
        amber: 'text-amber-600 dark:text-amber-400',
    };

    return (
        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
            <p className={`text-2xl font-bold ${colorClass[color] || colorClass.primary}`}>
                {value.toLocaleString()}
                {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
            </p>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{label}</p>
            {prev > 0 && (
                <p className={`text-xs mt-0.5 ${diff >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)}% vs 전월
                </p>
            )}
        </div>
    );
}

/* ── 월간 운영 지표 섹션 ── */
interface Props {
    monthlyStats: MonthlyStatsData;
    weeklyActiveRate: { active: number; total: number };
    onboardingStats: { total: number; completed: number; rate: number };
}

export default function DashboardMonthlyMetrics({ monthlyStats, weeklyActiveRate, onboardingStats }: Props) {
    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                📅 {monthlyStats.monthLabel} 운영 지표
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <MonthlyMetric label="이번 달 운행" value={monthlyStats.logs} prev={monthlyStats.prevLogs} unit="회" color="primary" />
                <MonthlyMetric label="이번 달 주행" value={monthlyStats.distance} prev={monthlyStats.prevDistance} unit="km" color="emerald" />
                <MonthlyMetric label="활성 사용자" value={monthlyStats.activeUsers} prev={monthlyStats.prevActiveUsers} unit="명" color="amber" />
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
                        {weeklyActiveRate.active}<span className="text-sm font-normal ml-0.5">명</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">주간 활성 (WAU)</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                        {weeklyActiveRate.total > 0 ? Math.round((weeklyActiveRate.active / weeklyActiveRate.total) * 100) : 0}% 활성률
                    </p>
                </div>
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className={`text-2xl font-bold ${onboardingStats.rate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : onboardingStats.rate >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {onboardingStats.rate}<span className="text-sm font-normal ml-0.5">%</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">온보딩 완료율</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                        {onboardingStats.completed}/{onboardingStats.total} 기관
                    </p>
                </div>
            </div>
        </div>
    );
}
