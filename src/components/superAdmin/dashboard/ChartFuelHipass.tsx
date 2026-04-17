import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { tooltipStyle, tooltipLocaleFormatter } from './dashboardUtils';
import type { FuelStatsData, HipassStatsData } from './dashboardUtils';

interface Props {
    fuelStats: FuelStatsData | null;
    hipassStats: HipassStatsData | null;
    dailyFuelCost: { date: string; cost: number }[];
    dailyHipassAmount: { date: string; amount: number }[];
}

function ChartFuelHipass({ fuelStats, hipassStats, dailyFuelCost, dailyHipassAmount }: Props) {
    const chartContent = useMemo(() => (
        <>
            {/* ── 주유 / 하이패스 월간 지표 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {(fuelStats || hipassStats) && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 lg:col-span-2">
                        {fuelStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 주유</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.monthCost.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 주유 건수</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.totalCost.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                        {hipassStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 하이패스</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.monthAmount.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 하이패스 충전</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.totalAmount.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── 주유/하이패스 일별 추이 (30일) ── */}
            {(dailyFuelCost.length > 0 || dailyHipassAmount.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 주유 비용 추이 */}
                    {dailyFuelCost.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                ⛽ 주유 비용 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 주유 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyFuelCost} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorFuelCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyFuelCost.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={tooltipLocaleFormatter('원', '주유 금액')} />
                                        <Area type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} fill="url(#colorFuelCost)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* 하이패스 충전 추이 */}
                    {dailyHipassAmount.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                🛣️ 하이패스 충전 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 하이패스 충전 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyHipassAmount} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorHipassAmt" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyHipassAmount.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={tooltipLocaleFormatter('원', '충전 금액')} />
                                        <Area type="monotone" dataKey="amount" stroke="#14b8a6" strokeWidth={2} fill="url(#colorHipassAmt)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    ), [fuelStats, hipassStats, dailyFuelCost, dailyHipassAmount]);

    return chartContent;
}

export default React.memo(ChartFuelHipass);
