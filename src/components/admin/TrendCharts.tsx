/**
 * TrendCharts — 트렌드 분석 차트 서브 컴포넌트
 * Recharts 기반: 월별 추이, 직원 비교, 차량 가동률, 운행 히트맵
 */
import {
    LineChart, Line, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import HeatmapGrid from '../common/HeatmapGrid';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

function SectionTitle({ title }: { title: string; icon?: string }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/* 월별 추이 라인 차트 툴팁 */
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
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
function UtilTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label}</p>
            <p className="text-primary-600">가동률: <span className="font-mono font-bold">{payload[0]?.value}%</span></p>
            <p className="text-surface-400 text-xs mt-1">운행일 {payload[0]?.payload?.usedDays}일 / 근무일 {payload[0]?.payload?.totalWorkdays}일</p>
        </div>
    );
}

interface TrendChartsProps {
    monthlyTrend: any[];
    driverComparison: any[];
    vehicleUtilization: any[];
    heatmapData: { grid: Record<number, Record<number, number>>; maxCount: number };
    costTrend: { label: string; fuelCost: number; hipassCost: number; totalCost: number }[];
}

export default function TrendCharts({
    monthlyTrend, driverComparison, vehicleUtilization, heatmapData, costTrend,
}: TrendChartsProps) {
    const recentDrivers = driverComparison.slice(0, 10); // 상위 10명
    const monthLabels = recentDrivers[0]?.monthLabels || [];

    return (
        <div className="space-y-6">
            {/* 월별 운행 추이 */}
            <div className="glass-card p-5">
                <SectionTitle icon="📈" title="월별 운행 추이" />
                {monthlyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
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
                    <ResponsiveContainer width="100%" height={Math.max(200, recentDrivers.length * 40)} minWidth={1} minHeight={1}>
                        <BarChart data={recentDrivers} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11 }} />
                            <Tooltip content={<TrendTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {monthLabels.map((ml: string, i: number) => (
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
                    <ResponsiveContainer width="100%" height={Math.max(180, vehicleUtilization.length * 45)} minWidth={1} minHeight={1}>
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

            {/* 월별 비용 추이 (주유비 + 하이패스) */}
            {costTrend.some(c => c.totalCost > 0) && (
                <div className="glass-card p-5">
                    <SectionTitle icon="💰" title="월별 비용 추이 (주유비 + 하이패스)" />
                    <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                        <BarChart data={costTrend} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                            <Tooltip
                                formatter={(value: any, name: any) => [
                                    `${Number(value).toLocaleString()}원`,
                                    name === 'fuelCost' ? '주유비' : '하이패스',
                                ]}
                            />
                            <Legend formatter={(v) => v === 'fuelCost' ? '주유비' : '하이패스 충전'} wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="fuelCost" name="fuelCost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="hipassCost" name="hipassCost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 운행 밀도 히트맵 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🔥" title="운행 밀도 히트맵 (시간대 × 요일)" />
                <HeatmapGrid data={heatmapData} />
            </div>
        </div>
    );
}
