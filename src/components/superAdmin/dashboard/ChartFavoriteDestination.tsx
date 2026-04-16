import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

interface Props {
    favoriteStats: { date: string; favorite: number; normal: number }[];
    favoriteRatio: { total: number; favorite: number; normal: number; rate: number };
    favoriteUserRatio: { total: number; withFavorite: number; rate: number };
}

export default function ChartFavoriteDestination({ favoriteStats, favoriteRatio, favoriteUserRatio }: Props) {
    if (favoriteStats.length === 0) {
        return (
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    ⭐ 자주 가는 목적지(즐겨찾기) 활용 현황
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                    목적지를 즐겨찾기에서 선택하여 운행한 비율 (최근 30일 로그 기준)
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
                        ⭐ 자주 가는 목적지(즐겨찾기) 활용 현황
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500">
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
                            <div className="text-[11px] text-indigo-500 mb-0.5">유저 보유율</div>
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
                            <div className="text-[11px] text-teal-500 mb-0.5">로그 즐겨찾기율</div>
                            <div className="text-sm font-bold text-teal-600 dark:text-teal-400">{favoriteRatio.rate}%</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="mt-6">
                <ResponsiveContainer width="100%" height={256} minWidth={1}>
                    <AreaChart data={favoriteStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="colorNormal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="colorFav" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.05} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(favoriteStats.length / 8)} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip {...tooltipStyle}
                            content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                if (!active || !payload?.length) return null;
                                const data = payload[0]?.payload;
                                if (!data) return null;
                                const total = data.normal + data.favorite;
                                return (
                                    <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                        <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 4 }}>총 {total}건</span></p>
                                        <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                            📝 일반 목적지: <b>{data.normal}건</b>
                                        </p>
                                        <p style={{ color: '#14b8a6', margin: '3px 0' }}>
                                            ⭐ 즐겨찾기 목적지: <b>{data.favorite}건</b>
                                        </p>
                                    </div>
                                );
                            }} />
                        <Legend formatter={(value: string) => value === 'normal' ? '📝 일반 목적지' : '⭐ 즐겨찾기 목적지'}
                            wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                        <Area type="monotone" dataKey="normal" stackId="res" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorNormal)" />
                        <Area type="monotone" dataKey="favorite" stackId="res" stroke="#14b8a6" strokeWidth={2} fill="url(#colorFav)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
