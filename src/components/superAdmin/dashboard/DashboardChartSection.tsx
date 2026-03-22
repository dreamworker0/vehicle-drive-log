import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend, Cell,
    PieChart, Pie,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type {
    FuelStatsData, HipassStatsData,
    FirstEmployeeStatsData,
} from './dashboardUtils';

interface Props {
    // 일별 기관 추이
    dailyActiveOrgStats: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[];
    // 활성 사용자 추이
    dailyActiveUserStats: { date: string; users: number }[];
    // 첫 직원 등록 소요시간
    firstEmployeeStats: FirstEmployeeStatsData | null;
    firstEmployeeDist: { label: string; count: number; color: string }[];
    firstEmployeeTrend: { month: string; avg: number }[];
    // 입력 방식 추이
    inputMethodStats: { date: string; ocr: number; manual: number }[];
    // 기관/차량 분포
    orgSizeDistribution: { label: string; count: number; color: string }[];
    fuelTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleModelStats: { model: string; count: number }[];
    // 하이패스
    hipassRatio: { withHipass: number; withoutHipass: number };
    hipassTopOrgs: { name: string; count: number }[];
    // 주유/하이패스 지표
    fuelStats: FuelStatsData | null;
    hipassStats: HipassStatsData | null;
    dailyFuelCost: { date: string; cost: number }[];
    dailyHipassAmount: { date: string; amount: number }[];
}

export default function DashboardChartSection({
    dailyActiveOrgStats,
    dailyActiveUserStats,
    firstEmployeeStats,
    firstEmployeeDist,
    firstEmployeeTrend,
    inputMethodStats,
    orgSizeDistribution,
    fuelTypeStats,
    vehicleTypeStats,
    vehicleModelStats,
    hipassRatio,
    hipassTopOrgs,
    fuelStats,
    hipassStats,
    dailyFuelCost,
    dailyHipassAmount,
}: Props) {
    return (
        <>
            {/* ── 일별 기관 추이 ── */}
            {dailyActiveOrgStats.length > 0 && (
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
                                    content={({ active, payload, label }: any) => {
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
            )}

            {/* ── 활성 사용자 추이 ── */}
            {dailyActiveUserStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        👤 일별 활성 사용자 (DAU)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">출발 기록이 있는 고유 사용자 수</p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={dailyActiveUserStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorDau" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyActiveUserStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    formatter={(value: any) => [`${value}명`, '활성 사용자']}
                                />
                                <Area type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2.5}
                                    fill="url(#colorDau)" dot={{ r: 2, fill: '#06b6d4' }} activeDot={{ r: 5, fill: '#06b6d4' }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 첫 직원 등록 소요시간 분석 ── */}
            {firstEmployeeStats && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        ⏱ 기관 승인 → 첫 직원 등록 소요시간
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        승인일부터 첫 번째 직원이 가입하기까지 걸린 일수 (총 {firstEmployeeStats.total}개 기관 기준)
                    </p>

                    {/* 요약 카드 */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                {firstEmployeeStats.avg}<span className="text-sm font-normal ml-0.5">일</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">평균 소요일</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                {firstEmployeeStats.median}<span className="text-sm font-normal ml-0.5">일</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">중앙값</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                                {firstEmployeeStats.sameDayRate}<span className="text-sm font-normal ml-0.5">%</span>
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">당일 등록 비율</p>
                        </div>
                    </div>

                    {/* 소요일 분포 히스토그램 + 월별 트렌드 (2열 그리드) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* 소요일 분포 */}
                        {firstEmployeeDist.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📊 소요일 분포</h3>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <BarChart data={firstEmployeeDist} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip
                                            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                            labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                            itemStyle={{ color: '#e5e7eb' }}
                                            formatter={(value: any) => [`${value}개 기관`, '기관 수']}
                                        />
                                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                            {firstEmployeeDist.map((entry, idx) => (
                                                <Cell key={idx} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {/* 월별 평균 소요일 트렌드 */}
                        {firstEmployeeTrend.length > 1 && (
                            <div>
                                <h3 className="text-sm font-medium text-surface-600 dark:text-surface-400 mb-3">📈 월별 평균 소요일 추이</h3>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={firstEmployeeTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorFirstEmpTrend" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            label={{ value: '일', position: 'insideTopLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                                        <Tooltip
                                            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 13 }}
                                            labelStyle={{ color: '#e5e7eb', fontWeight: 600 }}
                                            itemStyle={{ color: '#e5e7eb' }}
                                            formatter={(value: any) => [`${value}일`, '평균 소요일']}
                                        />
                                        <Area type="monotone" dataKey="avg" stroke="#8b5cf6" strokeWidth={2.5}
                                            fill="url(#colorFirstEmpTrend)" dot={{ r: 3, fill: '#8b5cf6' }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 입력 방식 스택 그래프 ── */}
            {inputMethodStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        📊 입력 방식 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                    </p>
                    <div>
                        <ResponsiveContainer width="100%" height={256} minWidth={1}>
                            <AreaChart data={inputMethodStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="colorManual" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(inputMethodStats.length / 8)} />
                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip {...tooltipStyle}
                                    content={({ active, payload, label }: any) => {
                                        if (!active || !payload?.length) return null;
                                        const data = payload[0]?.payload;
                                        if (!data) return null;
                                        const total = data.ocr + data.manual;
                                        return (
                                            <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                                <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400 }}>총 {total}건</span></p>
                                                <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                                    📷 계기판 촬영: <b>{data.ocr}건</b>
                                                </p>
                                                <p style={{ color: '#06b6d4', margin: '3px 0' }}>
                                                    ⌨️ 수동 입력: <b>{data.manual}건</b>
                                                </p>
                                            </div>
                                        );
                                    }} />
                                <Legend formatter={(value: string) => value === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력'}
                                    wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                                <Area type="monotone" dataKey="manual" stackId="input" stroke="#06b6d4" strokeWidth={2} fill="url(#colorManual)" />
                                <Area type="monotone" dataKey="ocr" stackId="input" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorOcr)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── 2열 그리드: 기관 규모별 | 연료 유형별 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 기관 규모별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🏗️ 기관 규모별 분포
                    </h2>
                    <div className="space-y-3">
                        {orgSizeDistribution.map(item => {
                            const maxCount = Math.max(...orgSizeDistribution.map(d => d.count), 1);
                            return (
                                <div key={item.label}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}개</span>
                                    </div>
                                    <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
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

                {/* 연료 유형별 분포 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        ⛽ 연료 유형별 분포
                    </h2>
                    {fuelTypeStats.length > 0 ? (
                        <div className="space-y-3">
                            {fuelTypeStats.map(item => {
                                const maxCount = Math.max(...fuelTypeStats.map(d => d.count), 1);
                                return (
                                    <div key={item.type}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm text-surface-600 dark:text-surface-300">{item.label}</span>
                                            <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                        </div>
                                        <div className="h-6 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: item.color }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                    )}
                </div>
            </div>

            {/* ── 차량 유형별 분포 ── */}
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                    🚗 차량 유형별 분포
                </h2>
                {vehicleTypeStats.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {vehicleTypeStats.map(item => {
                            const total = vehicleTypeStats.reduce((s, d) => s + d.count, 0);
                            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                            const ICONS: Record<string, string> = { compact: '🚙', sedan: '🚗', van: '🚐', truck: '🚚', bus: '🚌' };
                            return (
                                <div key={item.type} className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                    <div className="text-3xl mb-2">{ICONS[item.type] || '🚗'}</div>
                                    <p className="text-sm font-medium text-surface-600 dark:text-surface-300">{item.label}</p>
                                    <p className="text-2xl font-bold mt-1" style={{ color: item.color }}>
                                        {item.count}<span className="text-sm font-normal ml-0.5">대</span>
                                    </p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">{pct}%</p>
                                    <div className="mt-2 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-surface-400 dark:text-surface-500">차량 데이터 없음</p>
                )}
            </div>

            {/* ── 차량 모델별 분포 ── */}
            {vehicleModelStats.length > 0 && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🚘 차량 모델별 분포
                    </h2>
                    <div className="space-y-2">
                        {vehicleModelStats.map((item, idx) => {
                            const maxCount = vehicleModelStats[0]?.count || 1;
                            const colors = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#a855f7', '#6d28d9'];
                            const color = colors[idx % colors.length];
                            return (
                                <div key={item.model}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-surface-600 dark:text-surface-300">{item.model}</span>
                                        <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">{item.count}대</span>
                                    </div>
                                    <div className="h-5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: color }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 하이패스 연결 현황 ── */}
            {(hipassRatio.withHipass > 0 || hipassRatio.withoutHipass > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 하이패스 연결 비율 도넛 */}
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🛣️ 하이패스 연결 비율
                        </h2>
                        {(() => {
                            const total = hipassRatio.withHipass + hipassRatio.withoutHipass;
                            const pct = total > 0 ? Math.round((hipassRatio.withHipass / total) * 100) : 0;
                            const donutData = [
                                { name: '연결됨', value: hipassRatio.withHipass, color: '#14b8a6' },
                                { name: '미연결', value: hipassRatio.withoutHipass, color: '#374151' },
                            ];
                            return (
                                <div className="flex items-center justify-center gap-8">
                                    <div className="relative">
                                        <ResponsiveContainer width={180} height={180}>
                                            <PieChart>
                                                <Pie
                                                    data={donutData}
                                                    dataKey="value"
                                                    cx="50%" cy="50%"
                                                    innerRadius={55} outerRadius={80}
                                                    paddingAngle={3}
                                                    startAngle={90} endAngle={-270}
                                                    stroke="none"
                                                >
                                                    {donutData.map((entry, idx) => (
                                                        <Cell key={idx} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    {...tooltipStyle}
                                                    formatter={(value: any, name: any) => [`${value}대`, name]}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        {/* 중앙 텍스트 */}
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="text-3xl font-bold text-teal-500 dark:text-teal-400">{pct}%</span>
                                            <span className="text-xs text-surface-400 dark:text-surface-500">연결율</span>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
                                            <span className="text-sm text-surface-600 dark:text-surface-300">연결됨</span>
                                            <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withHipass}대</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#374151' }} />
                                            <span className="text-sm text-surface-600 dark:text-surface-300">미연결</span>
                                            <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withoutHipass}대</span>
                                        </div>
                                        <div className="border-t border-surface-200 dark:border-surface-700 pt-2">
                                            <span className="text-xs text-surface-400 dark:text-surface-500">전체 {total}대</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* 하이패스 사용 기관 TOP 5 */}
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🏆 하이패스 사용 기관 TOP 5
                        </h2>
                        {hipassTopOrgs.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                <BarChart data={hipassTopOrgs} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                        axisLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#d1d5db' }} tickLine={false}
                                        axisLine={false} width={100} />
                                    <Tooltip {...tooltipStyle} formatter={(value: any) => [`${value}대`, '하이패스 차량']} />
                                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                                        {hipassTopOrgs.map((_entry, idx) => (
                                            <Cell key={idx} fill={`hsl(${170 - idx * 12}, 65%, ${45 + idx * 5}%)`} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-sm text-surface-400 dark:text-surface-500">하이패스 연결 차량이 없습니다</p>
                        )}
                    </div>
                </div>
            )}

            {/* ── 주유 / 하이패스 월간 지표 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {(fuelStats || hipassStats) && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 lg:col-span-2">
                        {fuelStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 주유</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.monthCost.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                        {fuelStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 주유 건수</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{fuelStats.totalCost.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                        {hipassStats && (
                            <>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.monthCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 하이패스</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.monthAmount.toLocaleString()}원</p>
                                </div>
                                <div className="flex flex-col items-center justify-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl min-h-[100px]">
                                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                                        {hipassStats.totalCount}<span className="text-sm font-normal ml-0.5">건</span>
                                    </p>
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">총 하이패스 충전</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{hipassStats.totalAmount.toLocaleString()}원</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── 주유/하이패스 일별 추이 (30일) ── */}
            {(dailyFuelCost.length > 0 || dailyHipassAmount.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 주유 비용 추이 */}
                    {dailyFuelCost.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                ⛽ 주유 비용 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 주유 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyFuelCost} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorFuelCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyFuelCost.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={(value: any) => [`${Number(value).toLocaleString()}원`, '주유 금액']} />
                                        <Area type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} fill="url(#colorFuelCost)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* 하이패스 충전 추이 */}
                    {dailyHipassAmount.length > 0 && (
                        <div className="glass-card p-5">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                                🛣️ 하이패스 충전 추이 (최근 30일)
                            </h2>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                                서비스 전체 일별 하이패스 충전 금액
                            </p>
                            <div>
                                <ResponsiveContainer width="100%" height={220} minWidth={1}>
                                    <AreaChart data={dailyHipassAmount} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorHipassAmt" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyHipassAmount.length / 8)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                                            tickFormatter={(v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString()} />
                                        <Tooltip {...tooltipStyle} formatter={(value: any) => [`${Number(value).toLocaleString()}원`, '충전 금액']} />
                                        <Area type="monotone" dataKey="amount" stroke="#14b8a6" strokeWidth={2} fill="url(#colorHipassAmt)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
