import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

interface Props {
    dailyActiveOrgStats: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[];
}

export default function ChartOrgTrend({ dailyActiveOrgStats }: Props) {
    if (dailyActiveOrgStats.length === 0) return null;
    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                📈 일별 기관 추이 (최근 30일)
            </h2>
            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                신청일 기준 누적 기관 수 (활성/미활성/반려/삭제)
            </p>
            <div>
                <ResponsiveContainer width="100%" height={280} minWidth={1}>
                    <AreaChart data={dailyActiveOrgStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="colorOrgActive" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="colorOrgInactive" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="colorOrgRejected" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="colorOrgDeleted" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6b7280" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#6b7280" stopOpacity={0.05} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyActiveOrgStats.length / 8)} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip {...tooltipStyle}
                            content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                if (!active || !payload?.length) return null;
                                const data = payload[0]?.payload;
                                if (!data) return null;
                                return (
                                    <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                        <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label}</p>
                                        <p style={{ color: '#22c55e', margin: '3px 0' }}>🟢 활성: <b>{data.active}개</b> {data.dayActive > 0 && <span style={{ color: '#4ade80' }}>(+{data.dayActive})</span>}</p>
                                        <p style={{ color: '#f59e0b', margin: '3px 0' }}>🟡 미활성: <b>{data.inactive}개</b> {data.dayInactive > 0 && <span style={{ color: '#fbbf24' }}>(+{data.dayInactive})</span>}</p>
                                        <p style={{ color: '#ef4444', margin: '3px 0' }}>🔴 반려: <b>{data.rejected}개</b> {data.dayRejected > 0 && <span style={{ color: '#f87171' }}>(+{data.dayRejected})</span>}</p>
                                        <p style={{ color: '#6b7280', margin: '3px 0' }}>⚫ 삭제: <b>{data.deleted}개</b> {data.dayDeleted > 0 && <span style={{ color: '#9ca3af' }}>(+{data.dayDeleted})</span>}</p>
                                    </div>
                                );
                            }} />
                        <Legend formatter={(value: string) => {
                            const labels: Record<string, string> = { active: '🟢 활성', inactive: '🟡 미활성', rejected: '🔴 반려', deleted: '⚫ 삭제' };
                            return labels[value] || value;
                        }} wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                        <Area type="monotone" dataKey="active" stackId="org" stroke="#22c55e" strokeWidth={2} fill="url(#colorOrgActive)" />
                        <Area type="monotone" dataKey="inactive" stackId="org" stroke="#f59e0b" strokeWidth={2} fill="url(#colorOrgInactive)" />
                        <Area type="monotone" dataKey="rejected" stackId="org" stroke="#ef4444" strokeWidth={1.5} fill="url(#colorOrgRejected)" />
                        <Area type="monotone" dataKey="deleted" stackId="org" stroke="#6b7280" strokeWidth={1.5} fill="url(#colorOrgDeleted)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
