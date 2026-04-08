import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

interface Props {
    recommendationStats: { date: string; recommendation: number; normal: number }[];
    recommendationRatio: { total: number; recommendation: number; normal: number; rate: number };
}

export default function ChartRecommendation({ recommendationStats, recommendationRatio }: Props) {
    if (recommendationStats.length === 0) return null;

    return (
        <div className="glass-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        💡 추천 예약 활용 현황 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500">
                        빈 시간 추천 기능을 통한 예약 생성 추이
                    </p>
                </div>
                {/* 콤보: 누적 요약 비율 */}
                <div className="flex items-center gap-4 bg-surface-50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                    <div className="text-center">
                        <div className="text-[11px] text-surface-500 mb-0.5">최근 총 생성</div>
                        <div className="text-sm font-bold text-surface-700 dark:text-surface-300">{recommendationRatio.total.toLocaleString()}건</div>
                    </div>
                    <div className="w-px h-8 bg-surface-200 dark:bg-surface-700"></div>
                    <div className="text-center">
                        <div className="text-[11px] text-amber-500 mb-0.5">추천 예약 비율</div>
                        <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{recommendationRatio.rate}%</div>
                    </div>
                </div>
            </div>
            
            <div className="mt-6">
                <ResponsiveContainer width="100%" height={256} minWidth={1}>
                    <AreaChart data={recommendationStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="colorNormal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(recommendationStats.length / 8)} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip {...tooltipStyle}
                            content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                if (!active || !payload?.length) return null;
                                const data = payload[0]?.payload;
                                if (!data) return null;
                                const total = data.normal + data.recommendation;
                                return (
                                    <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                        <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 4 }}>총 {total}건</span></p>
                                        <p style={{ color: '#3b82f6', margin: '3px 0' }}>
                                            📅 일반 예약: <b>{data.normal}건</b>
                                        </p>
                                        <p style={{ color: '#f59e0b', margin: '3px 0' }}>
                                            💡 추천 예약: <b>{data.recommendation}건</b>
                                        </p>
                                    </div>
                                );
                            }} />
                        <Legend formatter={(value: string) => value === 'normal' ? '📅 일반 예약' : '💡 추천 예약'}
                            wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                        <Area type="monotone" dataKey="normal" stackId="res" stroke="#3b82f6" strokeWidth={2} fill="url(#colorNormal)" />
                        <Area type="monotone" dataKey="recommendation" stackId="res" stroke="#f59e0b" strokeWidth={2} fill="url(#colorRec)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
