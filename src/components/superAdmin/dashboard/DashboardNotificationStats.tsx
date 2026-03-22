import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { NotifSummaryData } from './dashboardUtils';

interface Props {
    notifSummary: NotifSummaryData;
    dailyNotifStats: { date: string; sent: number; read: number }[];
    notifTypeStats: { type: string; count: number; color: string }[];
}

export default function DashboardNotificationStats({ notifSummary, dailyNotifStats, notifTypeStats }: Props) {
    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                🔔 알림 활용 현황
            </h2>

            {/* 요약 카드 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {notifSummary.total.toLocaleString()}
                        <span className="text-sm font-normal ml-0.5">건</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 알림 발송</p>
                </div>
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {notifSummary.read.toLocaleString()}
                        <span className="text-sm font-normal ml-0.5">건</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">읽음</p>
                </div>
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                        {notifSummary.unread.toLocaleString()}
                        <span className="text-sm font-normal ml-0.5">건</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">미읽음</p>
                </div>
                <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                    <p className={`text-2xl font-bold ${notifSummary.readRate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : notifSummary.readRate >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {notifSummary.readRate}
                        <span className="text-sm font-normal ml-0.5">%</span>
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">읽음률</p>
                </div>
            </div>

            {/* 일별 알림 추이 */}
            {dailyNotifStats.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">📊 일별 알림 추이 (최근 30일)</h3>
                    <ResponsiveContainer width="100%" height={220} minWidth={1}>
                        <AreaChart data={dailyNotifStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorNotifSent" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="colorNotifRead" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyNotifStats.length / 8)} />
                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle}
                                content={({ active, payload, label }: any) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0]?.payload;
                                    if (!data) return null;
                                    const rate = data.sent > 0 ? Math.round((data.read / data.sent) * 100) : 0;
                                    return (
                                        <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                            <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label}</p>
                                            <p style={{ color: '#818cf8', margin: '3px 0' }}>📨 발송: <b>{data.sent}건</b></p>
                                            <p style={{ color: '#34d399', margin: '3px 0' }}>✅ 읽음: <b>{data.read}건</b></p>
                                            <p style={{ color: '#9ca3af', margin: '3px 0' }}>읽음률: <b>{rate}%</b></p>
                                        </div>
                                    );
                                }} />
                            <Legend formatter={(value: string) => value === 'sent' ? '📨 발송' : '✅ 읽음'}
                                wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                            <Area type="monotone" dataKey="sent" stackId="notif" stroke="#818cf8" strokeWidth={2} fill="url(#colorNotifSent)" />
                            <Area type="monotone" dataKey="read" stackId="notif" stroke="#34d399" strokeWidth={2} fill="url(#colorNotifRead)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 알림 타입별 분포 */}
            {notifTypeStats.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-3">📋 알림 타입별 분포</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {notifTypeStats.map(item => {
                            const maxCount = Math.max(...notifTypeStats.map(d => d.count), 1);
                            return (
                                <div key={item.type}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.type}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}건</span>
                                    </div>
                                    <div className="h-4 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
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
            )}
        </div>
    );
}
