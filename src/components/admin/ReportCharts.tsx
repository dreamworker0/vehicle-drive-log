/**
 * ReportCharts — 통계 보고서 차트 탭 (MonthlyReport에서 분리)
 */
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area
} from 'recharts';
import useChartTheme, { formatWonTick } from '../../hooks/useChartTheme';
import { hourlyRange } from '../../hooks/utils/monthlyReportCalc';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

interface ChartPayloadEntry {
    value: number;
    name: string;
    color: string;
    dataKey?: string;
    unit?: string;
    payload?: Record<string, unknown>;
}

function SectionTitle({ title }: { title: string; icon?: string }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/**
 * 거리 막대 툴팁 — 주행거리와 운행 건수를 함께 보여 준다.
 *
 * 예전에는 km와 건수를 **한 축에** 나란히 그려, 단위가 다른 두 값 중 건수 막대가 거의 보이지
 * 않았다(300km 옆의 5건). 막대는 거리 하나만 그리고 건수는 여기서 읽는다.
 */
function DistanceCountTooltip({ active, payload, label }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as { distance?: number; count?: number } | undefined;
    return (
        <div className="bg-white/95 dark:bg-surface-800/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}</p>
            <p className="text-surface-600 dark:text-surface-400">
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: payload[0]?.color }} />
                주행거리: <span className="font-semibold text-surface-900 dark:text-surface-100 ml-1">{(row?.distance ?? 0).toLocaleString()} km</span>
            </p>
            <p className="text-surface-600 dark:text-surface-400 pl-4">
                운행 <span className="font-semibold text-surface-900 dark:text-surface-100">{row?.count ?? 0}건</span>
            </p>
        </div>
    );
}

/** 단순 카운트 툴팁 */
function SimpleCountTooltip({ active, payload, label, suffix = '' }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string; suffix?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white/95 dark:bg-surface-800/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}{suffix}</p>
            <p className="text-surface-600 dark:text-surface-400">
                {payload[0]?.name === 'count' ? '운행' : '출발'}{' '}
                <span className="font-semibold text-surface-900 dark:text-surface-100">{payload[0]?.value}건</span>
            </p>
        </div>
    );
}

/** 일별 추이 툴팁 — 선은 운행 건수 하나, 주행거리는 여기서 함께 보여 준다(한 축에 km와 건수를 섞지 않는다) */
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as { count?: number; distance?: number } | undefined;
    return (
        <div className="bg-white/95 dark:bg-surface-800/95 backdrop-blur-sm rounded-xl shadow-lg border border-surface-100 dark:border-surface-700 px-4 py-3 text-sm">
            <p className="font-semibold text-surface-700 dark:text-surface-300 mb-1">{label}</p>
            <p className="text-surface-600 dark:text-surface-400">
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: payload[0]?.color }} />
                운행 건수: <span className="font-semibold text-surface-900 dark:text-surface-100 ml-1">{row?.count ?? 0}건</span>
            </p>
            <p className="text-surface-600 dark:text-surface-400 pl-4">
                주행거리 <span className="font-semibold text-surface-900 dark:text-surface-100">{(row?.distance ?? 0).toLocaleString()}km</span>
            </p>
        </div>
    );
}


interface ReportChartsProps {
    driverData: { name: string; distance: number; count: number }[];
    vehicleData: { name: string; distance: number; count: number }[];
    purposeData: { name: string; value: number }[];
    dayOfWeekData: { name: string; count: number }[];
    hourlyData: { hour: string; count: number }[];
    dailyTrendData: { date: string; count: number; distance: number }[];
    fuelLogStats: { totalCost: number; count: number; vehicleData: { name: string; cost: number }[] };
    hipassChargeStats: { totalAmount: number; count: number; vehicleData: { name: string; amount: number }[] };
    costTrendData: { date: string; fuel: number; hipass: number; total: number }[];
}

export default function ReportCharts({
    driverData, vehicleData, purposeData,
    dayOfWeekData, hourlyData, dailyTrendData,
    fuelLogStats, hipassChargeStats, costTrendData,
}: ReportChartsProps) {
    const t = useChartTheme();
    const [hourLo, hourHi] = hourlyRange(hourlyData);
    const hourlyShown = hourlyData.filter((_, i) => i >= hourLo && i <= hourHi);
    return (
        <div className="space-y-6">
            {/* 직원별 + 차량별 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass-card p-5">
                    <SectionTitle icon="👤" title="직원별 주행거리" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <BarChart data={driverData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: t.tick }} unit="km" />
                                <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11, fill: t.tickStrong }} />
                                <Tooltip content={<DistanceCountTooltip />} cursor={t.cursor} />
                                <Bar dataKey="distance" name="주행거리" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={16} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5">
                    <SectionTitle icon="🚗" title="차량별 주행거리" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <BarChart data={vehicleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: t.tick }} unit="km" />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: t.tickStrong }} />
                                <Tooltip content={<DistanceCountTooltip />} cursor={t.cursor} />
                                <Bar dataKey="distance" name="주행거리" fill="#10b981" radius={[0, 4, 4, 0]} barSize={16} />
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
                            <Tooltip {...t.tooltip} cursor={t.cursor} formatter={(value) => `${value}회`} />
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
                                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                                <XAxis dataKey="name" tick={{ fontSize: 12, fill: t.tickStrong }} />
                                <YAxis tick={{ fontSize: 11, fill: t.tick }} allowDecimals={false} />
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
                            <BarChart data={hourlyShown} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                                {/* 범위가 넓어지면(심야 포함) 17칸을 넘어 라벨이 붙는다 — 칸이 많으면 걸러 찍는다 */}
                                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: t.tickStrong }} interval={hourlyShown.length > 17 ? 2 : hourlyShown.length > 12 ? 1 : 0} />
                                <YAxis tick={{ fontSize: 11, fill: t.tick }} allowDecimals={false} />
                                <Tooltip content={<SimpleCountTooltip />} />
                                <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={18}>
                                    {hourlyShown.map((entry, index) => (
                                        <Cell
                                            key={`hr-${index}`}
                                            fill={entry.count > 0 ? '#06b6d4' : t.grid}
                                            fillOpacity={entry.count > 0 ? 0.85 : 0.4}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* (차량별 주유비는 아래 주유 기록 기준 차트 하나로 본다 — 운행일지의 옛 연료 필드로 그리던 중복 차트를 없앴다) */}

            {/* 일별 운행 추이 */}
            {dailyTrendData.length > 1 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="📈" title="일별 운행 건수" />
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={280} minWidth={1} minHeight={1}>
                            <LineChart data={dailyTrendData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: t.tickStrong }} />
                                <YAxis tick={{ fontSize: 11, fill: t.tick }} allowDecimals={false} />
                                <Tooltip content={<TrendTooltip />} />
                                <Line type="monotone" dataKey="count" name="count" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} />
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
                                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: t.tickStrong }} />
                                <YAxis tick={{ fontSize: 11, fill: t.tick }} tickFormatter={formatWonTick} />
                                <Tooltip
                                    {...t.tooltip}
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
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: t.tick }} tickFormatter={formatWonTick} />
                                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: t.tickStrong }} />
                                    <Tooltip {...t.tooltip} cursor={t.cursor} formatter={(value) => [`${(value as number).toLocaleString()}원`, '주유비']} />
                                    <Bar dataKey="cost" fill="#f59e0b" radius={[0, 6, 6, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-surface-400 dark:text-surface-500 text-center py-8">주유 기록이 없습니다</p>
                    )}
                </div>

                {/* 차량별 하이패스 충전 */}
                <div className="glass-card p-5">
                    <SectionTitle icon="🛣️" title="차량별 하이패스 충전" />
                    {hipassChargeStats.vehicleData.length > 0 ? (
                        <div className="w-full">
                            <ResponsiveContainer width="100%" height={Math.max(200, hipassChargeStats.vehicleData.length * 45)} minWidth={1} minHeight={1}>
                                <BarChart data={hipassChargeStats.vehicleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: t.tick }} tickFormatter={formatWonTick} />
                                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: t.tickStrong }} />
                                    <Tooltip {...t.tooltip} cursor={t.cursor} formatter={(value) => [`${(value as number).toLocaleString()}원`, '충전액']} />
                                    <Bar dataKey="amount" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-surface-400 dark:text-surface-500 text-center py-8">하이패스 충전 기록이 없습니다</p>
                    )}
                </div>
            </div>
        </div>
    );
}
