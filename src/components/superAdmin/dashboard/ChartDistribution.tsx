import React, { useMemo, useState } from 'react';

interface Props {
    orgSizeDistribution: { label: string; count: number; color: string }[];
    fuelTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleModelStats: { model: string; count: number }[];
    vehicleModelStatsActive: { model: string; count: number }[];
    vehicleModelStatsRetired: { model: string; count: number }[];
}

function ChartDistribution({ 
    orgSizeDistribution = [], 
    fuelTypeStats = [], 
    vehicleTypeStats = [], 
    vehicleModelStats = [], 
    vehicleModelStatsActive = [], 
    vehicleModelStatsRetired = [] 
}: Props) {
    const [filterState, setFilterState] = useState<'all' | 'active' | 'retired'>('all');

    const chartContent = useMemo(() => {
        let displayModelStats = vehicleModelStats;
        if (filterState === 'active') displayModelStats = vehicleModelStatsActive;
        else if (filterState === 'retired') displayModelStats = vehicleModelStatsRetired;

        return (
            <>
                {/* ── 2열 그리드: 기관 규모별 | 연료 유형별 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 기관 규모별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🏗️ 기관 규모별 분포
                    </h2>
                    <div className="space-y-3">
                        {orgSizeDistribution.map(item => {
                            const maxCount = Math.max(...orgSizeDistribution.map(d => d.count), 1);
                            return (
                                <div key={item.label}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}개</span>
                                    </div>
                                    <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: item.color }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 연료 유형별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        ⛽ 연료 유형별 분포
                    </h2>
                    {fuelTypeStats.length > 0 ? (
                        <div className="space-y-3">
                            {fuelTypeStats.map(item => {
                                const maxCount = Math.max(...fuelTypeStats.map(d => d.count), 1);
                                return (
                                    <div key={item.type}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                            <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                        </div>
                                        <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: item.color }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                    )}
                </div>
            </div>

            {/* ── 차량 유형별 분포 ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                    🚗 차량 유형별 분포
                </h2>
                {vehicleTypeStats.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {vehicleTypeStats.map(item => {
                            const total = vehicleTypeStats.reduce((s, d) => s + d.count, 0);
                            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                            const ICONS: Record<string, string> = { compact: '🚙', sedan: '🚗', van: '🚐', truck: '🚚', bus: '🚌' };
                            return (
                                <div key={item.type} className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                    <div className="text-3xl mb-2">{ICONS[item.type] || '🚗'}</div>
                                    <p className="text-sm font-medium text-surface-600 dark:text-surface-300">{item.label}</p>
                                    <p className="text-2xl font-bold mt-1" style={{ color: item.color }}>
                                        {item.count}<span className="text-sm font-normal ml-0.5">대</span>
                                    </p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">{pct}%</p>
                                    <div className="mt-2 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                )}
            </div>

            {/* ── 차량 모델별 분포 ── */}
            {(vehicleModelStats.length > 0 || displayModelStats.length > 0) && (
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                            🚘 차량 모델별 분포
                        </h2>
                        <select
                            value={filterState}
                            onChange={(e) => setFilterState(e.target.value as 'all' | 'active' | 'retired')}
                            className="p-1.5 text-sm bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="all">전체</option>
                            <option value="active">운영 중</option>
                            <option value="retired">폐차</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        {displayModelStats.length > 0 ? displayModelStats.map((item, idx) => {
                            const maxCount = displayModelStats[0]?.count || 1;
                            const colors = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#a855f7', '#6d28d9'];
                            const color = colors[idx % colors.length];
                            return (
                                <div key={item.model}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.model}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                    </div>
                                    <div className="h-5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: color }}
                                        />
                                    </div>
                                </div>
                            );
                        }) : (
                            <p className="text-sm text-surface-400 dark:text-surface-500 py-2 text-center">해당 상태의 차량이 없습니다.</p>
                        )}
                    </div>
                </div>
            )}
        </>
    );
    }, [orgSizeDistribution, fuelTypeStats, vehicleTypeStats, vehicleModelStats, vehicleModelStatsActive, vehicleModelStatsRetired, filterState]);

    return chartContent;
}

export default React.memo(ChartDistribution);
