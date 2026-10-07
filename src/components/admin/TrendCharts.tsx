/**
 * TrendCharts — 트렌드 분석 차트 서브 컴포넌트
 * Recharts 기반: 월별 추이, 직원 비교, 차량 가동률, 운행 히트맵
 */
import {
    LineChart, Line, BarChart, Bar, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import HeatmapGrid from '../common/HeatmapGrid';
import useChartTheme from '../../hooks/useChartTheme';
import DriveOriginChart, { type DriveOriginPoint, type DriveOriginRow } from './DriveOriginChart';

interface ChartPayloadEntry {
    value: number;
    name: string;
    color: string;
    unit?: string;
    payload?: Record<string, unknown>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

function SectionTitle({ title }: { title: string; icon?: string }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/* 월별 추이 라인 차트 툴팁 */
function TrendTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string; unit?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color }} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
                    {p.name}: <span className="font-mono font-medium">{p.value?.toLocaleString()}{p.unit || unit}</span>
                </p>
            ))}
        </div>
    );
}

/* 가동률 바 차트 툴팁 */
function UtilTooltip({ active, payload, label }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label}</p>
            <p className="text-primary-600">가동률: <span className="font-mono font-bold">{payload[0]?.value}%</span></p>
            <p className="text-surface-400 text-xs mt-1">운행일 {String(payload[0]?.payload?.usedDays ?? '')}일 / 근무일 {String(payload[0]?.payload?.totalWorkdays ?? '')}일 (공휴일 제외 · 이번 달은 오늘까지)</p>
        </div>
    );
}

interface TrendChartsProps {
    monthlyTrend: { label: string; count: number; distance: number; [key: string]: unknown }[];
    driveOriginTrend: DriveOriginPoint[];
    driveOriginByDriver?: DriveOriginRow[];
    driveOriginByVehicle?: DriveOriginRow[];
    driverComparison: { name: string; monthLabels?: string[]; [key: string]: unknown }[];
    vehicleUtilization: { name: string; rate: number; usedDays?: number; totalWorkdays?: number }[];
    heatmapData: { grid: Record<number, Record<number, number>>; maxCount: number };
}

export default function TrendCharts({
    monthlyTrend, driveOriginTrend, driveOriginByDriver, driveOriginByVehicle, driverComparison, vehicleUtilization, heatmapData,
}: TrendChartsProps) {
    const t = useChartTheme();
    // 월 키는 늘 6~12개라 length로는 빈 상태를 못 가른다 — 전부 0이면 0 선만 그려졌다
    const hasTrend = monthlyTrend.some(m => (m.count || 0) > 0 || (m.distance || 0) > 0);
    const recentDrivers = driverComparison.slice(0, 10); // 상위 10명
    const monthLabels = (recentDrivers[0]?.monthLabels as string[]) || [];

    return (
        <div className="space-y-6">
            {/* 월별 운행 추이 — 단위가 다른 두 값(건·km)을 한 차트의 양쪽 축에 그리지 않는다.
                예전 이중 축은 축 제목이 없어 어느 쪽이 무엇인지 알 수 없었다. 같은 달 축으로 두 개를 나란히 둔다. */}
            <div className="glass-card p-5">
                <SectionTitle icon="📈" title="월별 운행 추이" />
                {hasTrend ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {([
                            { key: 'count', label: '운행 횟수', unit: '건', color: '#3b82f6' },
                            { key: 'distance', label: '주행거리', unit: 'km', color: '#10b981' },
                        ] as const).map(m => (
                            <div key={m.key}>
                                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">{m.label} ({m.unit})</p>
                                <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                                    <LineChart data={monthlyTrend} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: t.tick }} />
                                        <YAxis tick={{ fontSize: 11, fill: t.tick }} allowDecimals={false} />
                                        <Tooltip content={<TrendTooltip unit={m.unit} />} />
                                        <Line type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-surface-400 text-center py-8">데이터가 없습니다</p>
                )}
            </div>

            {/* 운행 방식 (사전 예약 · 바로 운행 · 예약 없이 기록) */}
            <DriveOriginChart data={driveOriginTrend} byDriver={driveOriginByDriver} byVehicle={driveOriginByVehicle} />

            {/* 직원별 운행 비교 */}
            <div className="glass-card p-5">
                <SectionTitle icon="👤" title="직원별 운행 비교 (최근 3개월)" />
                {recentDrivers.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(200, recentDrivers.length * 40)} minWidth={1} minHeight={1}>
                        <BarChart data={recentDrivers} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                            <XAxis type="number" tick={{ fontSize: 11, fill: t.tick }} allowDecimals={false} />
                            <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11, fill: t.tickStrong }} />
                            <Tooltip content={<TrendTooltip unit="건" />} cursor={t.cursor} />
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
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={t.grid} />
                            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: t.tick }} unit="%" />
                            <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11, fill: t.tickStrong }} />
                            <Tooltip content={<UtilTooltip />} cursor={t.cursor} />
                            <Bar dataKey="rate" name="가동률" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={20}>
                                {/* Recharts는 막대별 색을 <Cell>로만 받는다 — 예전 <rect>는 무시돼 전부 보라색이었다 */}
                                {vehicleUtilization.map((v, i) => {
                                    const color = v.rate >= 60 ? '#10b981' : v.rate >= 30 ? '#f59e0b' : '#ef4444';
                                    return <Cell key={i} fill={color} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-surface-400 text-center py-8">차량 데이터가 없습니다</p>
                )}
            </div>

            {/* (월별 비용 추이는 '비용 최적화' 탭 하나로 본다 — 정비비가 빠진 같은 이름의 차트가 여기에도 있었다) */}

            {/* 운행 밀도 히트맵 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🔥" title="운행 밀도 히트맵 (시간대 × 요일)" />
                <HeatmapGrid data={heatmapData} />
            </div>
        </div>
    );
}
