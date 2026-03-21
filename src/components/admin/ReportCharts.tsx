/**
 * ReportCharts — 통계 보고서 차트 탭 (MonthlyReport에서 분리)
 */
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

function SectionTitle({ title }: { title: string; icon?: string }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/** 거리/횟수 막대차트에서 공통으로 사용하는 툴팁 */
function DistanceCountTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="text-surface-600 dark:text-surface-400">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: p.color }} />
                    {p.dataKey === 'distance' ? '주행거리' : '운행횟수'}:
                    <span className="font-semibold text-surface-900 dark:text-surface-100 ml-1">
                        {p.dataKey === 'distance' ? `${p.value.toLocaleString()} km` : `${p.value}건`}
                    </span>
                </p>
            ))}
        </div>
    );
}

/** 단순 카운트 툴팁 */
function SimpleCountTooltip({ active, payload, label, suffix = '' }: { active?: boolean; payload?: any[]; label?: string; suffix?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}{suffix}</p>
            <p className="text-surface-600 dark:text-surface-400">
                {payload[0]?.name === 'count' ? '운행' : '출발'}{' '}
                <span className="font-semibold text-surface-900 dark:text-surface-100">{payload[0]?.value}건</span>
            </p>
        </div>
    );
}

/** 일별 추이 라인차트 툴팁 */
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="text-surface-600 dark:text-surface-400">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: p.color }} />
                    {p.dataKey === 'count' ? '운행 건수' : '주행거리'}:
                    <span className="font-semibold text-surface-900 dark:text-surface-100 ml-1">
                        {p.dataKey === 'count' ? `${p.value}건` : `${p.value.toLocaleString()}km`}
                    </span>
                </p>
            ))}
        </div>
    );
}

interface ReportChartsProps {
    driverData: any[];
    vehicleData: any[];
    purposeData: any[];
    dayOfWeekData: any[];
    hourlyData: any[];
    vehicleFuelData: any[];
    dailyTrendData: any[];
    fuelLogStats: { totalCost: number; totalAmount: number; count: number; vehicleData: any[] };
    hipassChargeStats: { totalAmount: number; count: number; vehicleData: any[] };
    costTrendData: { date: string; fuel: number; hipass: number; total: number }[];
}

export default function ReportCharts({
    driverData, vehicleData, purposeData,
    dayOfWeekData, hourlyData, vehicleFuelData, dailyTrendData,
    fuelLogStats, hipassChargeStats, costTrendData,
}: ReportChartsProps) {
    return (
        <div className="space-y-6">
            {/* 직원별 + 차량별 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass-card p-5">
                    <SectionTitle icon="👤" title="직원별 현황" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <BarChart data={driverData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11, fill: '#64748b' }} />
                                <Tooltip content={<DistanceCountTooltip />} />
                                <Bar dataKey="distance" name="주행거리" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={14} />
                                <Bar dataKey="count" name="운행횟수" fill="#93c5fd" radius={[0, 4, 4, 0]} barSize={14} />
                                <Legend formatter={(v) => v === 'distance' ? '주행거리(km)' : '운행횟수'} wrapperStyle={{ fontSize: '11px' }} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5">
                    <SectionTitle icon="🚗" title="차량별 주행거리" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <BarChart data={vehicleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: '#64748b' }} />
                                <Tooltip content={<DistanceCountTooltip />} />
                                <Bar dataKey="distance" name="주행거리" fill="#10b981" radius={[0, 4, 4, 0]} barSize={14} />
                                <Bar dataKey="count" name="운행횟수" fill="#6ee7b7" radius={[0, 4, 4, 0]} barSize={14} />
                                <Legend formatter={(v) => v === 'distance' ? '주행거리(km)' : '운행횟수'} wrapperStyle={{ fontSize: '11px' }} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* 목적별 비율 */}
            <div className="glass-card p-5">
                <SectionTitle icon="📋" title="사용목적별 비율" />
                <div className="w-full flex justify-center">
                    <ResponsiveContainer width="100%" height={300} minWidth={1} minHeight={1}>
                        <PieChart>
                            <Pie
                                data={purposeData} cx="50%" cy="50%"
                                innerRadius={60} outerRadius={100} paddingAngle={3}
                                dataKey="value" nameKey="name"
                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                            >
                                {purposeData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value) => `${value}회`} />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 요일별 + 시간대별 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass-card p-5">
                    <SectionTitle icon="📅" title="요일별 운행 패턴" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={240} minWidth={1} minHeight={1}>
                            <BarChart data={dayOfWeekData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                <Tooltip content={<SimpleCountTooltip suffix="요일" />} />
                                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} barSize={28}>
                                    {dayOfWeekData.map((entry, index) => (
                                        <Cell
                                            key={`dow-${index}`}
                                            fill={index === 0 || index === 6 ? '#f87171' : '#8b5cf6'}
                                            fillOpacity={entry.count > 0 ? 0.85 : 0.3}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5">
                    <SectionTitle icon="🕐" title="시간대별 출발 빈도" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={240} minWidth={1} minHeight={1}>
                            <BarChart data={hourlyData.filter((_, i) => i >= 6 && i <= 22)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                                <Tooltip content={<SimpleCountTooltip />} />
                                <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={18}>
                                    {hourlyData.filter((_, i) => i >= 6 && i <= 22).map((entry, index) => (
                                        <Cell
                                            key={`hr-${index}`}
                                            fill={entry.count > 0 ? '#06b6d4' : '#e2e8f0'}
                                            fillOpacity={entry.count > 0 ? 0.85 : 0.4}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* 차량별 주유/충전비 */}
            {vehicleFuelData.length > 0 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="⛽" title="차량별 주유/충전비" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <BarChart data={vehicleFuelData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: '#64748b' }} />
                                <Tooltip formatter={(value) => [`${(value as number).toLocaleString()}원`, '주유/충전비']} />
                                <Bar dataKey="amount" fill="#f59e0b" radius={[0, 6, 6, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* 일별 운행 추이 */}
            {dailyTrendData.length > 1 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="📈" title="일별 운행 추이" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <LineChart data={dailyTrendData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                <Tooltip content={<TrendTooltip />} />
                                <Legend formatter={(v) => v === 'count' ? '운행 건수' : '주행거리(km)'} />
                                <Line type="monotone" dataKey="count" name="count" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} />
                                <Line type="monotone" dataKey="distance" name="distance" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* 비용 추이 (주유비 vs 하이패스) */}
            {costTrendData.length > 1 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="💰" title="일별 비용 추이 (주유비 vs 하이패스)" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <AreaChart data={costTrendData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                                <Tooltip
                                    formatter={(value, name) => [
                                        `${(value as number).toLocaleString()}원`,
                                        name === 'fuel' ? '주유비' : name === 'hipass' ? '하이패스' : '합계'
                                    ]}
                                />
                                <Legend formatter={(v) => v === 'fuel' ? '주유비' : v === 'hipass' ? '하이패스' : '합계'} />
                                <Area type="monotone" dataKey="fuel" name="fuel" stackId="1" fill="#f59e0b" fillOpacity={0.4} stroke="#f59e0b" strokeWidth={2} />
                                <Area type="monotone" dataKey="hipass" name="hipass" stackId="1" fill="#8b5cf6" fillOpacity={0.4} stroke="#8b5cf6" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* 주유비 + 하이패스 충전 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 차량별 주유비 */}
                <div className="glass-card p-5">
                    <SectionTitle icon="⛽" title="차량별 주유비" />
                    {fuelLogStats.vehicleData.length > 0 ? (
                        <div className="w-full">
                            <ResponsiveContainer width="100%" height={Math.max(200, fuelLogStats.vehicleData.length * 45)} minWidth={1} minHeight={1}>
                                <BarChart data={fuelLogStats.vehicleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: '#64748b' }} />
                                    <Tooltip formatter={(value) => [`${(value as number).toLocaleString()}원`, '주유비']} />
                                    <Bar dataKey="cost" fill="#f59e0b" radius={[0, 6, 6, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-surface-400 text-center py-8">주유 기록이 없습니다</p>
                    )}
                </div>

                {/* 차량별 하이패스 충전 */}
                <div className="glass-card p-5">
                    <SectionTitle icon="🛣️" title="차량별 하이패스 충전" />
                    {hipassChargeStats.vehicleData.length > 0 ? (
                        <div className="w-full">
                            <ResponsiveContainer width="100%" height={Math.max(200, hipassChargeStats.vehicleData.length * 45)} minWidth={1} minHeight={1}>
                                <BarChart data={hipassChargeStats.vehicleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: '#64748b' }} />
                                    <Tooltip formatter={(value) => [`${(value as number).toLocaleString()}원`, '충전액']} />
                                    <Bar dataKey="amount" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-surface-400 text-center py-8">하이패스 충전 기록이 없습니다</p>
                    )}
                </div>
            </div>
        </div>
    );
}
