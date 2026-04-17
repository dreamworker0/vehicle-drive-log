import React, { useMemo } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { tooltipFormatter } from './dashboardUtils';
import type { FirstEmployeeStatsData } from './dashboardUtils';

interface Props {
    firstEmployeeStats: FirstEmployeeStatsData | null;
    firstEmployeeDist: { label: string; count: number; color: string }[];
    firstEmployeeTrend: { month: string; avg: number }[];
}

function ChartFirstEmployee({ firstEmployeeStats, firstEmployeeDist, firstEmployeeTrend }: Props) {
    const chartContent = useMemo(() => {
        if (!firstEmployeeStats) {
            return (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        ⏱ 기관 승인 → 첫 직원 등록 소요시간
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        승인일부터 첫 번째 직원이 가입하기까지 걸린 일수
                    </p>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }
        return (
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    ⏱ 기관 승인 → 첫 직원 등록 소요시간
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                    승인일부터 첫 번째 직원이 가입하기까지 걸린 일수 (총 {firstEmployeeStats.total}개 기관 기준)
                </p>

                {/* 요약 카드 */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {firstEmployeeStats.avg}<span className="text-sm font-normal ml-0.5">일</span>
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">평균 소요일</p>
                    </div>
                    <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            {firstEmployeeStats.median}<span className="text-sm font-normal ml-0.5">일</span>
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">중앙값</p>
                    </div>
                    <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                            {firstEmployeeStats.sameDayRate}<span className="text-sm font-normal ml-0.5">%</span>
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">당일 등록 비율</p>
                    </div>
                </div>

                {/* 소요일 분포 히스토그램 + 월별 트렌드 (2열 그리드) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 소요일 분포 */}
                    {firstEmployeeDist.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📊 소요일 분포</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={firstEmployeeDist} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip
                                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                        labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                        itemStyle={{ color: '#e5e7eb' }}
                                        formatter={tooltipFormatter('개 기관', '기관 수')}
                                    />
                                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                        {firstEmployeeDist.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* 월별 평균 소요일 트렌드 */}
                    {firstEmployeeTrend.length > 1 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📈 월별 평균 소요일 추이</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={firstEmployeeTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorFirstEmpTrend" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                        label={{ value: '일', position: 'insideTopLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                                    <Tooltip
                                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                        labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                        itemStyle={{ color: '#e5e7eb' }}
                                        formatter={tooltipFormatter('일', '평균 소요일')}
                                    />
                                    <Area type="monotone" dataKey="avg" stroke="#8b5cf6" strokeWidth={2.5}
                                        fill="url(#colorFirstEmpTrend)" dot={{ r: 3, fill: '#8b5cf6' }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            </div>
        );
    }, [firstEmployeeStats, firstEmployeeDist, firstEmployeeTrend]);

    return chartContent;
}

export default React.memo(ChartFirstEmployee);
