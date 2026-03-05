/**
 * TrendCharts — 트렌드 분석 차트 서브 컴포넌트
 * Recharts 기반: 월별 추이, 직원 비교, 차량 가동률, 운행 히트맵
 */
import {
    LineChart, Line, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function SectionTitle({ title }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/* 월별 추이 라인 차트 툴팁 */
function TrendTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
                    {p.name}: <span className="font-mono font-medium">{p.value?.toLocaleString()}{p.unit || ''}</span>
                </p>
            ))}
        </div>
    );
}

/* 가동률 바 차트 툴팁 */
function UtilTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label}</p>
            <p className="text-primary-600">가동률: <span className="font-mono font-bold">{payload[0]?.value}%</span></p>
            <p className="text-surface-400 text-xs mt-1">운행일 {payload[0]?.payload?.usedDays}일 / 근무일 {payload[0]?.payload?.totalWorkdays}일</p>
        </div>
    );
}

/* 히트맵 컴포넌트 (커스텀 그리드) */
function HeatmapGrid({ data }) {
    const { grid, maxCount } = data;
    const hours = Array.from({ length: 13 }, (_, i) => i + 6); // 06시~18시 주요 시간만

    const getColor = (count) => {
        if (count === 0) return 'bg-surface-100 dark:bg-surface-800';
        const intensity = Math.min(count / maxCount, 1);
        if (intensity < 0.25) return 'bg-primary-100 dark:bg-primary-900/40';
        if (intensity < 0.5) return 'bg-primary-200 dark:bg-primary-800/60';
        if (intensity < 0.75) return 'bg-primary-400 dark:bg-primary-600/80';
        return 'bg-primary-600 dark:bg-primary-500';
    };

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[500px]">
                {/* 시간 헤더 */}
                <div className="flex items-center gap-0.5 mb-0.5 pl-10">
                    {hours.map(h => (
                        <div key={h} className="flex-1 text-center text-[10px] text-surface-400 font-mono">
                            {h}
                        </div>
                    ))}
                </div>
                {/* 요일 행 — 월~금 우선, 주말 뒤에 */}
                {[1, 2, 3, 4, 5, 6, 0].map(dayIdx => (
                    <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
                        <span className={`w-9 text-xs font-medium text-right pr-1 ${dayIdx === 0 || dayIdx === 6 ? 'text-red-400' : 'text-surface-500 dark:text-surface-400'}`}>
                            {DAY_NAMES[dayIdx]}
                        </span>
                        {hours.map(h => (
                            <div
                                key={h}
                                className={`flex-1 aspect-square rounded-sm ${getColor(grid[dayIdx][h])} transition-colors cursor-default`}
                                title={`${DAY_NAMES[dayIdx]} ${h}시: ${grid[dayIdx][h]}건`}
                            />
                        ))}
                    </div>
                ))}
                {/* 범례 */}
                <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-surface-400">
                    <span>적음</span>
                    <div className="w-3 h-3 rounded-sm bg-surface-100 dark:bg-surface-800" />
                    <div className="w-3 h-3 rounded-sm bg-primary-100 dark:bg-primary-900/40" />
                    <div className="w-3 h-3 rounded-sm bg-primary-200 dark:bg-primary-800/60" />
                    <div className="w-3 h-3 rounded-sm bg-primary-400 dark:bg-primary-600/80" />
                    <div className="w-3 h-3 rounded-sm bg-primary-600 dark:bg-primary-500" />
                    <span>많음</span>
                </div>
            </div>
        </div>
    );
}

export default function TrendCharts({
    monthlyTrend, driverComparison, vehicleUtilization, heatmapData,
}) {
    const recentDrivers = driverComparison.slice(0, 10); // 상위 10명
    const monthLabels = recentDrivers[0]?.monthLabels || [];

    return (
        <div className="space-y-6">
            {/* 월별 운행 추이 */}
            <div className="glass-card p-5">
                <SectionTitle icon="📈" title="월별 운행 추이" />
                {monthlyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={monthlyTrend} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                            <Tooltip content={<TrendTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line yAxisId="left" type="monotone" dataKey="count" name="운행 횟수" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                            <Line yAxisId="right" type="monotone" dataKey="distance" name="주행거리(km)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-surface-400 text-center py-8">데이터가 없습니다</p>
                )}
            </div>

            {/* 직원별 운행 비교 */}
            <div className="glass-card p-5">
                <SectionTitle icon="👤" title="직원별 운행 비교 (최근 3개월)" />
                {recentDrivers.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(200, recentDrivers.length * 40)}>
                        <BarChart data={recentDrivers} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11 }} />
                            <Tooltip content={<TrendTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {monthLabels.map((ml, i) => (
                                <Bar key={ml} dataKey={`${ml}_count`} name={ml} fill={COLORS[i % COLORS.length]} radius={[0, 4, 4, 0]} />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-surface-400 text-center py-8">데이터가 없습니다</p>
                )}
            </div>

            {/* 차량 가동률 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🚗" title="차량 가동률 (최근 3개월)" />
                {vehicleUtilization.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(180, vehicleUtilization.length * 45)}>
                        <BarChart data={vehicleUtilization} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                            <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                            <Tooltip content={<UtilTooltip />} />
                            <Bar dataKey="rate" name="가동률" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={20}>
                                {vehicleUtilization.map((v, i) => {
                                    const color = v.rate >= 60 ? '#10b981' : v.rate >= 30 ? '#f59e0b' : '#ef4444';
                                    return <rect key={i} fill={color} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-surface-400 text-center py-8">차량 데이터가 없습니다</p>
                )}
            </div>

            {/* 운행 밀도 히트맵 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🔥" title="운행 밀도 히트맵 (요일 × 시간대)" />
                <HeatmapGrid data={heatmapData} />
            </div>
        </div>
    );
}
