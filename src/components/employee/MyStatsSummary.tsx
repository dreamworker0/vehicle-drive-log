import { useMemo } from 'react';

interface DriveLogLike {
    date?: string;
    timestamp?: { toDate?: () => Date };
    startKm: number;
    endKm: number;
    fuelAmount?: number;
    energyCost?: number;
}

interface MyStatsSummaryProps {
    logs: DriveLogLike[];
}

/** 이번 달 / 지난 달 기간 계산 */
function getMonthRange(offset = 0) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + offset;
    const start = new Date(y, m, 1);
    const end = offset === 0 ? now : new Date(y, m + 1, 0); // 이번 달이면 오늘까지
    return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        label: `${start.getFullYear()}년 ${start.getMonth() + 1}월`,
    };
}

function getLogDate(log: DriveLogLike): string {
    return log.date || log.timestamp?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';
}

export default function MyStatsSummary({ logs }: MyStatsSummaryProps) {
    const thisMonth = useMemo(() => getMonthRange(0), []);
    const lastMonth = useMemo(() => getMonthRange(-1), []);

    const thisMonthLogs = useMemo(
        () => logs.filter(l => { const d = getLogDate(l); return d >= thisMonth.start && d <= thisMonth.end; }),
        [logs, thisMonth]
    );

    const lastMonthLogs = useMemo(
        () => logs.filter(l => { const d = getLogDate(l); return d >= lastMonth.start && d <= lastMonth.end; }),
        [logs, lastMonth]
    );

    const stats = useMemo(() => {
        const count = thisMonthLogs.length;
        const distance = thisMonthLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
        const cost = thisMonthLogs.reduce((s, l) => s + (l.fuelAmount || l.energyCost || 0), 0);

        // 일평균 (1일 ~ 오늘)
        const today = new Date();
        const dayOfMonth = today.getDate();
        const avgDaily = dayOfMonth > 0 ? (count / dayOfMonth).toFixed(1) : '0';

        // 전월 대비
        const prevCount = lastMonthLogs.length;
        const prevDistance = lastMonthLogs.reduce((s, l) => s + ((l.endKm - l.startKm) || 0), 0);
        const countChange = prevCount > 0 ? Math.round(((count - prevCount) / prevCount) * 100) : (count > 0 ? 100 : 0);
        const distanceChange = prevDistance > 0 ? Math.round(((distance - prevDistance) / prevDistance) * 100) : (distance > 0 ? 100 : 0);

        return { count, distance, cost, avgDaily, countChange, distanceChange };
    }, [thisMonthLogs, lastMonthLogs]);

    if (logs.length === 0) return null;

    return (
        <div className="mb-4 animate-fade-in">
            <h2 className="text-xs font-semibold text-surface-500 dark:text-surface-400 mb-2">
                {getMonthRange(0).label} 요약
            </h2>
            <div className="grid grid-cols-3 gap-2">
                {/* 운행 횟수 */}
                <div className="glass-card p-3 text-center">
                    <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{stats.count}</p>
                    <p className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">운행 횟수</p>
                    <ChangeIndicator value={stats.countChange} />
                </div>

                {/* 총 주행거리 */}
                <div className="glass-card p-3 text-center">
                    <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{stats.distance.toLocaleString()}</p>
                    <p className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">주행거리(km)</p>
                    <ChangeIndicator value={stats.distanceChange} />
                </div>

                {/* 일평균 */}
                <div className="glass-card p-3 text-center">
                    <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{stats.avgDaily}</p>
                    <p className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">일평균(회)</p>
                    {stats.cost > 0 && (
                        <p className="text-[10px] text-surface-400 mt-0.5">비용 {stats.cost.toLocaleString()}원</p>
                    )}
                </div>
            </div>
        </div>
    );
}

/** 전월 대비 증감 표시 */
function ChangeIndicator({ value }: { value: number }) {
    if (value === 0) return null;
    const isUp = value > 0;
    return (
        <span className={`text-[10px] font-medium ${isUp ? 'text-accent-600 dark:text-accent-400' : 'text-blue-600 dark:text-blue-400'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(value)}%
        </span>
    );
}
