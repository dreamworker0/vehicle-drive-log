import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

interface Props {
    reservationTypeStats: { date: string; single: number; multiDay: number; recurring: number }[];
    reservationTypeRatio: {
        total: number; single: number; multiDay: number; recurring: number;
        singleRate: number; multiDayRate: number; recurringRate: number;
    };
    futureReservationTypeStats?: { date: string; single: number; multiDay: number; recurring: number }[];
    futureReservationTypeRatio?: {
        total: number; single: number; multiDay: number; recurring: number;
        singleRate: number; multiDayRate: number; recurringRate: number;
    };
}

const LEGEND_MAP: Record<string, string> = {
    single: '📅 하루 예약',
    multiDay: '📆 다일 예약',
    recurring: '🔄 반복 예약',
};

function ChartReservationType({ reservationTypeStats, reservationTypeRatio, futureReservationTypeStats, futureReservationTypeRatio }: Props) {
    const [viewMode, setViewMode] = React.useState<'past' | 'future'>('past');

    const chartContent = useMemo(() => {
        const currentStats = viewMode === 'past' ? reservationTypeStats : (futureReservationTypeStats || []);
        const currentRatio = viewMode === 'past' ? reservationTypeRatio : (futureReservationTypeRatio || { total: 0, single: 0, multiDay: 0, recurring: 0, singleRate: 0, multiDayRate: 0, recurringRate: 0 });
        const periodText = viewMode === 'past' ? '최근 30일' : '향후 30일';

        const hasData = currentStats && currentStats.length > 0;

        return (
            <div className="glass-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                                📊 예약 유형별 비율 ({periodText})
                            </h2>
                            <div className="flex items-center bg-surface-100 dark:bg-surface-800 rounded-lg p-0.5 border border-surface-200 dark:border-surface-700">
                                <button
                                    onClick={() => setViewMode('past')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'past' ? 'bg-white dark:bg-surface-600 text-surface-800 dark:text-white shadow-sm' : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'}`}
                                >
                                    과거
                                </button>
                                <button
                                    onClick={() => setViewMode('future')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'future' ? 'bg-white dark:bg-surface-600 text-surface-800 dark:text-white shadow-sm' : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'}`}
                                >
                                    미래
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            하루 예약 · 다일(연속) 예약 · 반복(정기) 예약 비율 추이
                        </p>
                    </div>
                    {/* 요약 비율 */}
                    <div className="flex items-center gap-3 bg-surface-50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                        <div className="text-center">
                            <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-0.5">총 예약</div>
                            <div className="text-sm font-bold text-surface-700 dark:text-surface-300">{currentRatio.total.toLocaleString()}건</div>
                        </div>
                        <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                        <div className="text-center">
                            <div className="text-[11px] text-blue-500 dark:text-blue-400 mb-0.5">하루</div>
                            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">{currentRatio.singleRate}%</div>
                        </div>
                        <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                        <div className="text-center">
                            <div className="text-[11px] text-amber-500 dark:text-amber-400 mb-0.5">다일</div>
                            <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{currentRatio.multiDayRate}%</div>
                        </div>
                        <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                        <div className="text-center">
                            <div className="text-[11px] text-purple-500 dark:text-purple-400 mb-0.5">반복</div>
                            <div className="text-sm font-bold text-purple-600 dark:text-purple-400">{currentRatio.recurringRate}%</div>
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    {hasData ? (
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={currentStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorSingle" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorMultiDay" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorRecurring" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(currentStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                        if (!active || !payload?.length) return null;
                                        const data = payload[0]?.payload;
                                        if (!data) return null;
                                        const total = data.single + data.multiDay + data.recurring;
                                        return (
                                            <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                                <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 4 }}>총 {total}건</span></p>
                                                <p style={{ color: '#3b82f6', margin: '3px 0' }}>
                                                    📅 하루 예약: <b>{data.single}건</b>
                                                    {total > 0 && <span style={{ color: '#9ca3af', marginLeft: 6 }}>({Math.round((data.single / total) * 100)}%)</span>}
                                                </p>
                                                <p style={{ color: '#f59e0b', margin: '3px 0' }}>
                                                    📆 다일 예약: <b>{data.multiDay}건</b>
                                                    {total > 0 && <span style={{ color: '#9ca3af', marginLeft: 6 }}>({Math.round((data.multiDay / total) * 100)}%)</span>}
                                                </p>
                                                <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                                    🔄 반복 예약: <b>{data.recurring}건</b>
                                                    {total > 0 && <span style={{ color: '#9ca3af', marginLeft: 6 }}>({Math.round((data.recurring / total) * 100)}%)</span>}
                                                </p>
                                            </div>
                                        );
                                    }} />
                                <Legend formatter={(value: string) => LEGEND_MAP[value] || value}
                                    wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                <Area type="monotone" dataKey="single" stackId="resType" stroke="#3b82f6" strokeWidth={2} fill="url(#colorSingle)" />
                                <Area type="monotone" dataKey="multiDay" stackId="resType" stroke="#f59e0b" strokeWidth={2} fill="url(#colorMultiDay)" />
                                <Area type="monotone" dataKey="recurring" stackId="resType" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorRecurring)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[256px] text-surface-400 dark:text-surface-500">해당 기간에 발생한 데이터가 없습니다.</div>
                    )}
                </div>
            </div>
        );
    }, [reservationTypeStats, reservationTypeRatio, futureReservationTypeStats, futureReservationTypeRatio, viewMode]);

    return chartContent;
}

export default React.memo(ChartReservationType);
