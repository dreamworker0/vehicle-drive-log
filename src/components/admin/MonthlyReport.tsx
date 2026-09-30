/**
 * MonthlyReport — 운행 통계 보고서 페이지
 * 로직은 useMonthlyReport 훅 사용
 * 차트는 ReportCharts, 테이블은 ReportTables 서브 컴포넌트로 분리
 */
import { useState, Suspense, lazy } from 'react';
import useMonthlyReport from '../../hooks/useMonthlyReport';

const ReportCharts = lazy(() => import('./ReportCharts'));
import ReportTables from './ReportTables';
import { formatFuelAmount } from '../../lib/fuelFormat';

const PERIOD_OPTIONS = [
    { key: 'thisWeek', label: '이번 주' },
    { key: 'thisMonth', label: '이번 달' },
    { key: 'lastMonth', label: '지난 달' },
    { key: 'last3Months', label: '최근 3개월' },
];

function ChangeIndicator({ value }: { value?: number | null }) {
    // null: 비교 구간에 기록이 없다 — 예전에는 "+100%"로 보여 급증처럼 읽혔다
    if (value === null) return <span className="text-xs text-surface-400">비교 없음</span>;
    if (value === 0 || value === undefined) return <span className="text-xs text-surface-400">변동 없음</span>;
    const isUp = value > 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-accent-600' : 'text-red-500'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(value)}%
        </span>
    );
}

interface StatCardProps {
    icon: string;
    value: string | number;
    label: string;
    change?: number | null;
    sub?: string;
    color: string;
}

function StatCard({ icon, value, label, change, sub, color }: StatCardProps) {
    return (
        <div className="glass-card p-4 sm:p-5 relative overflow-hidden group hover:shadow-lg transition-shadow duration-300">
            <div className={`absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-10 ${color}`} />
            <div className="flex items-start justify-between mb-2">
                <span className="text-2xl">{icon}</span>
                <ChangeIndicator value={change} />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-surface-100 mt-1">{value}</p>
            <p className="text-xs text-surface-400 mt-1">{label}</p>
            {sub && <p className="text-[11px] text-surface-300 mt-0.5">{sub}</p>}
        </div>
    );
}

/** 'YYYY-MM-DD' → 'M/D' */
function formatMD(dateStr: string): string {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}`;
}

/** 단위별 주유량 — 휘발유 L · 전기 kWh · 수소 kg를 따로 적는다 */
function formatAmountByUnit(byUnit: Record<'L' | 'kWh' | 'kg', number>): string[] {
    return (['L', 'kWh', 'kg'] as const)
        .filter(u => byUnit[u] > 0)
        .map(u => `${formatFuelAmount(byUnit[u])}${u}`);
}

export default function MonthlyReport() {
    const {
        loading, loadError, startDate, endDate, setStartDate, setEndDate,
        activePeriod, setPeriod, comparePeriod,
        filteredLogs, stats, driverData, vehicleData, purposeData,
        dailyTrendData, dayOfWeekData, hourlyData,
        fuelLogStats, hipassChargeStats, costTrendData,
        exportExcel, exportPdf,
    } = useMonthlyReport();

    const [activeTab, setActiveTab] = useState('charts');

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div id="monthly-report-print" className="max-w-5xl mx-auto animate-fade-in">
            {/* 헤더 */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">운행 통계 보고서</h1>
                <div className="flex gap-2">
                    <button
                        onClick={exportPdf}
                        disabled={filteredLogs.length === 0}
                        className="btn-secondary btn-sm text-xs min-h-[48px]"
                    >
                        🖨️ PDF 인쇄
                    </button>
                    <button
                        onClick={exportExcel}
                        disabled={filteredLogs.length === 0}
                        className="btn-secondary btn-sm text-xs min-h-[48px]"
                    >
                        📥 엑셀 다운로드
                    </button>
                </div>
            </div>

            {/* 빠른 기간 선택 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {PERIOD_OPTIONS.map((op) => (
                    <button
                        key={op.key}
                        onClick={() => setPeriod(op.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${activePeriod === op.key
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-600'
                            }`}
                    >
                        {op.label}
                    </button>
                ))}
                <div className="flex items-center gap-1.5 ml-auto">
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="input text-xs py-1.5 max-w-[130px]"
                    />
                    <span className="text-surface-400 text-sm">~</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="input text-xs py-1.5 max-w-[130px]"
                    />
                </div>
            </div>

            {loadError && (
                <div role="alert" className="glass-card p-4 mb-4 border-l-4 border-l-red-400 text-sm text-red-600 dark:text-red-400">
                    {loadError}
                </div>
            )}

            {/* 요약 카드 */}
            <p className="text-[11px] text-surface-400 dark:text-surface-500 mb-2">
                ▲▼ 증감은 {comparePeriod.start === comparePeriod.end
                    ? formatMD(comparePeriod.start)
                    : `${formatMD(comparePeriod.start)}~${formatMD(comparePeriod.end)}`}과 비교한 값이에요
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <StatCard
                    icon="🚗" value={stats.totalRuns} label="총 운행 횟수"
                    change={stats.runsChange} sub={`일 평균 ${stats.avgDailyRuns}건`} color="bg-primary-400 dark:bg-primary-900/40"
                />
                <StatCard
                    icon="📏" value={stats.totalDistance.toLocaleString()} label="총 주행거리 (km)"
                    change={stats.distanceChange} sub={`건당 평균 ${stats.avgDistance.toLocaleString()}km`} color="bg-accent-400 dark:bg-accent-900/40"
                />
                <StatCard
                    icon="⛽" value={fuelLogStats.totalCost ? fuelLogStats.totalCost.toLocaleString() : '-'}
                    label="주유비 (원)" sub={fuelLogStats.count > 0 ? [`${fuelLogStats.count}건`, ...formatAmountByUnit(fuelLogStats.amountByUnit)].join(' · ') : ''} color="bg-amber-400 dark:bg-amber-900/40"
                />
                <StatCard
                    icon="🛣️" value={hipassChargeStats.totalAmount ? hipassChargeStats.totalAmount.toLocaleString() : '-'}
                    label="하이패스 충전 (원)" sub={hipassChargeStats.count > 0 ? `${hipassChargeStats.count}건` : ''} color="bg-purple-400 dark:bg-purple-900/40"
                />
            </div>

            {filteredLogs.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">📊</div>
                    <p className="text-surface-400 dark:text-surface-500 font-medium">해당 기간의 운행 기록이 없습니다</p>
                </div>
            ) : (
                <>
                    {/* 탭 선택 */}
                    <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1 mb-6">
                        {[
                            { key: 'charts', label: '차트 분석' },
                            { key: 'table', label: '상세 테이블' },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === tab.key
                                    ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'charts' ? (
                        <Suspense fallback={<div className="p-10 text-center text-surface-400 spinner mx-auto">차트를 불러오는 중...</div>}>
                            <ReportCharts
                                driverData={driverData}
                                vehicleData={vehicleData}
                                purposeData={purposeData}
                                dayOfWeekData={dayOfWeekData}
                                hourlyData={hourlyData}
                                dailyTrendData={dailyTrendData}
                                fuelLogStats={fuelLogStats}
                                hipassChargeStats={hipassChargeStats}
                                costTrendData={costTrendData}
                            />
                        </Suspense>
                    ) : (
                        <ReportTables
                            driverData={driverData}
                            vehicleData={vehicleData}
                            stats={{ ...stats, totalFuel: fuelLogStats.totalCost }}
                        />
                    )}

                    {/* 미완료 기록 */}
                    {stats.incompleteCount > 0 && (
                        <div className="glass-card p-5 border-l-4 border-l-amber-400 mt-6">
                            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2">미완료 기록</h2>
                            <p className="text-sm text-surface-500 dark:text-surface-400">
                                해당 기간에 <span className="font-bold text-amber-600">{stats.incompleteCount}건</span>의
                                미완료 운행 기록이 있습니다.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
