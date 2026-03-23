import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import HeatmapGrid from '../../common/HeatmapGrid';
import { tooltipStyle, tooltipFormatter } from './dashboardUtils';

interface Props {
    heatmapData: { grid: number[][]; maxCount: number };
    hourlyStats: { hour: string; count: number }[];
    monthlyGrowth: { month: string; cumulative: number }[];
    dailyAvgDuration: { date: string; avg: number }[];
    hourlyAvgDuration: { hour: string; avg: number }[];
    orgAvgDuration: { name: string; avg: number }[];
}

export default function DashboardDriveAnalysis({
    heatmapData,
    hourlyStats,
    monthlyGrowth,
    dailyAvgDuration,
    hourlyAvgDuration,
    orgAvgDuration,
}: Props) {
    return (
        <>
            {/* ── 2열 그리드: 피크 시간대 | 기관 증가 추이 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 피크 시간대 */}
                {hourlyStats.length > 0 && (
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            ⏰ 시간대별 운행 분포
                        </h2>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">최근 30일 출발 시간 기준</p>
                        <div>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hourlyStats} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={1}
                                        tickFormatter={(v: string) => v.replace('시', '')} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle} formatter={tooltipFormatter('건', '출발 건수')} />
                                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                        {hourlyStats.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.count > 0 ? '#8b5cf6' : '#374151'} opacity={entry.count > 0 ? 0.85 : 0.3} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* 기관 증가 추이 */}
                {monthlyGrowth.length > 0 && (
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                            🌱 기관 증가 추이
                        </h2>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">월별 누적 승인 기관 수</p>
                        <div>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={monthlyGrowth} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }}
                                        interval={monthlyGrowth.length > 8 ? Math.ceil(monthlyGrowth.length / 6) : 0} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle} formatter={tooltipFormatter('개', '누적 기관')} />
                                    <Area type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} fill="url(#colorGrowth)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}
            </div>

            {/* ── 운행 밀도 히트맵 (요일 × 시간대) ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    🔥 운행 밀도 히트맵 (요일 × 시간대)
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">최근 30일 서비스 전체 운행 밀도</p>
                <HeatmapGrid data={heatmapData} />
            </div>

            {/* ── 평균 주행시간 분석 ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    ⏱️ 평균 주행시간 분석
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                    startTime과 endTime 기반 주행시간 (최근 30일)
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 일별 평균 주행시간 */}
                    {dailyAvgDuration.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">📅 일별 평균 주행시간</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <AreaChart data={dailyAvgDuration} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorAvgDur" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyAvgDuration.length / 8)} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                        allowDecimals={false} unit="분" />
                                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter('분', '평균 주행시간')} />
                                    <Area type="monotone" dataKey="avg" stroke="#ec4899" strokeWidth={2} fill="url(#colorAvgDur)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* 시간대별 평균 주행시간 */}
                    {hourlyAvgDuration.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">⏰ 시간대별 평균 주행시간</h3>
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hourlyAvgDuration} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={{ stroke: '#4b5563' }} interval={1}
                                        tickFormatter={(v: string) => v.replace('시', '')} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                        allowDecimals={false} unit="분" />
                                    <Tooltip {...tooltipStyle} formatter={tooltipFormatter('분', '평균 주행시간')} />
                                    <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                                        {hourlyAvgDuration.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.avg > 0 ? '#f472b6' : '#374151'} opacity={entry.avg > 0 ? 0.85 : 0.3} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* 기관별 평균 주행시간 (운행 10건 이상) */}
                {orgAvgDuration.length > 0 && (
                    <div className="mt-6">
                        <h3 className="text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">🏢 기관별 평균 주행시간 (운행 10건 이상, 상위 15개)</h3>
                        <ResponsiveContainer width="100%" height={Math.max(200, orgAvgDuration.length * 32)} minWidth={1}>
                            <BarChart data={orgAvgDuration} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={false} unit="분" />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#d1d5db' }} tickLine={false}
                                    axisLine={false} width={100} />
                                <Tooltip {...tooltipStyle} formatter={tooltipFormatter('분', '평균 주행시간')} />
                                <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                                    {orgAvgDuration.map((_entry, idx) => (
                                        <Cell key={idx} fill={`hsl(${330 - idx * 8}, 70%, ${55 + idx * 1.5}%)`} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </>
    );
}
