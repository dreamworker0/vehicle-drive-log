import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';
import { CHART_NEUTRAL, CHART_SERIES } from '../../../lib/chartPalette';

interface Props {
    favoriteStats: { date: string; favorite: number; normal: number }[];
    favoriteRatio: { total: number; favorite: number; normal: number; rate: number };
    favoriteUserRatio: { total: number; withFavorite: number; rate: number };
}

function ChartFavoriteDestination({ favoriteStats, favoriteRatio, favoriteUserRatio }: Props) {
    const chartContent = useMemo(() => {
        if (!favoriteStats || favoriteStats.length === 0) {
            return (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        ⭐ 자주 가는 목적지(즐겨찾기) 활용 현황
                    </h2>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
                        목적지를 즐겨찾기에서 선택하여 운행한 비율 (최근 30일 로그 기준)
                    </p>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-500 dark:text-surface-400">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }

        return (
            <div className="glass-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            ⭐ 자주 가는 목적지(즐겨찾기) 활용 현황
                        </h2>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                            목적지를 즐겨찾기에서 선택하여 운행한 비율 (최근 30일 로그 기준)
                        </p>
                    </div>
                    {/* 우측 요약 지표 */}
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                        <div className="flex items-center gap-4 bg-surface-50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                            <div className="text-center">
                                <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-0.5">즐겨찾기 보유 유저</div>
                                <div className="text-sm font-bold text-surface-700 dark:text-surface-300">
                                    {favoriteUserRatio.withFavorite.toLocaleString()}명
                                </div>
                            </div>
                            <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                            <div className="text-center">
                                <div className="text-[11px] text-indigo-500 dark:text-indigo-400 mb-0.5">유저 보유율</div>
                                <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{favoriteUserRatio.rate}%</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 bg-surface-50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                            <div className="text-center">
                                <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-0.5">최근 30일 로그</div>
                                <div className="text-sm font-bold text-surface-700 dark:text-surface-300">{favoriteRatio.total.toLocaleString()}건</div>
                            </div>
                            <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                            <div className="text-center">
                                <div className="text-[11px] text-teal-500 dark:text-teal-400 mb-0.5">로그 즐겨찾기율</div>
                                <div className="text-sm font-bold text-teal-600 dark:text-teal-400">{favoriteRatio.rate}%</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    <ResponsiveContainer width="100%" height={256} minWidth={1}>
                        <AreaChart data={favoriteStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorNormalFav" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_SERIES.violet} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={CHART_SERIES.violet} stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="colorFav" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_SERIES.teal} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={CHART_SERIES.teal} stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL[700]} opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART_NEUTRAL[400] }} tickLine={false}
                                axisLine={{ stroke: CHART_NEUTRAL[600] }} interval={Math.ceil(favoriteStats.length / 8)} />
                            <YAxis tick={{ fontSize: 11, fill: CHART_NEUTRAL[400] }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle}
                                content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0]?.payload;
                                    if (!data) return null;
                                    const total = data.normal + data.favorite;
                                    return (
                                        <div style={{ background: CHART_NEUTRAL[800], border: `1px solid ${CHART_NEUTRAL[700]}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                            <p style={{ color: CHART_NEUTRAL[200], fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: CHART_NEUTRAL[400], fontWeight: 400, marginLeft: 4 }}>총 {total}건</span></p>
                                            <p style={{ color: CHART_SERIES.violet, margin: '3px 0' }}>
                                                📝 일반 목적지: <b>{data.normal}건</b>
                                            </p>
                                            <p style={{ color: CHART_SERIES.teal, margin: '3px 0' }}>
                                                ⭐ 즐겨찾기 목적지: <b>{data.favorite}건</b>
                                            </p>
                                        </div>
                                    );
                                }} />
                            <Legend formatter={(value: string) => value === 'normal' ? '📝 일반 목적지' : '⭐ 즐겨찾기 목적지'}
                                wrapperStyle={{ fontSize: '13px', color: CHART_NEUTRAL[400] }} />
                            <Area type="monotone" dataKey="normal" stackId="res" stroke={CHART_SERIES.violet} strokeWidth={2} fill="url(#colorNormalFav)" />
                            <Area type="monotone" dataKey="favorite" stackId="res" stroke={CHART_SERIES.teal} strokeWidth={2} fill="url(#colorFav)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        );
    }, [favoriteStats, favoriteRatio, favoriteUserRatio]);

    return chartContent;
}

export default React.memo(ChartFavoriteDestination);
