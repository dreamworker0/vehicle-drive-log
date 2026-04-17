import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

interface Props {
    quickDriveStats: { date: string; regular: number; quick: number }[];
    quickDriveRatio: { total: number; quick: number; regular: number; rate: number };
}

function ChartQuickDrive({ quickDriveStats, quickDriveRatio }: Props) {
    const chartContent = useMemo(() => {
        if (!quickDriveStats || quickDriveStats.length === 0) {
            return (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        🚀 사전 예약 vs 바로 운행 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        기존 예약 방식 대비 바로 운행(예약 없이 출발) 활용도 추이
                    </p>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }

        return (
            <div className="glass-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            🚀 사전 예약 vs 바로 운행 (최근 30일)
                        </h2>
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            기존 예약 방식 대비 바로 운행(예약 없이 출발) 활용도 추이
                        </p>
                    </div>
                    {/* 콤보: 누적 요약 비율 */}
                    <div className="flex items-center gap-4 bg-surface-50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                        <div className="text-center">
                            <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-0.5">최근 총 생성</div>
                            <div className="text-sm font-bold text-surface-700 dark:text-surface-300">{quickDriveRatio.total.toLocaleString()}건</div>
                        </div>
                        <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                        <div className="text-center">
                            <div className="text-[11px] text-emerald-500 mb-0.5">바로 운행 비율</div>
                            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{quickDriveRatio.rate}%</div>
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    <ResponsiveContainer width="100%" height={256} minWidth={1}>
                        <AreaChart data={quickDriveStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorRegular" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="colorQuick" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(quickDriveStats.length / 8)} />
                            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle}
                                content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0]?.payload;
                                    if (!data) return null;
                                    const total = data.regular + data.quick;
                                    return (
                                        <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                            <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 4 }}>총 {total}건</span></p>
                                            <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                                📅 사전 예약: <b>{data.regular}건</b>
                                            </p>
                                            <p style={{ color: '#10b981', margin: '3px 0' }}>
                                                🚀 바로 운행: <b>{data.quick}건</b>
                                            </p>
                                        </div>
                                    );
                                }} />
                            <Legend formatter={(value: string) => value === 'regular' ? '📅 사전 예약' : '🚀 바로 운행'}
                                wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                            <Area type="monotone" dataKey="regular" stackId="res" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorRegular)" />
                            <Area type="monotone" dataKey="quick" stackId="res" stroke="#10b981" strokeWidth={2} fill="url(#colorQuick)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        );
    }, [quickDriveStats, quickDriveRatio]);

    return chartContent;
}

export default React.memo(ChartQuickDrive);
