/**
 * AnalyticsDashboard — 고도화 분석 대시보드
 * 트렌드 분석 + 비용 최적화 탭 구성
 */
import { useState, Suspense, lazy } from 'react';
import useAnalytics from '../../hooks/useAnalytics';

const TrendCharts = lazy(() => import('./TrendCharts'));
const CostOptimization = lazy(() => import('./CostOptimization'));

const RANGE_OPTIONS = [
    { value: 3, label: '3개월' },
    { value: 6, label: '6개월' },
    { value: 12, label: '1년' },
];

/** 금액을 한국어 표기로 포맷 (원 → 만원 단위) */
function formatCost(amount: number): string {
    if (amount <= 0) return '-';
    if (amount < 10000) return `${amount.toLocaleString()}원`;
    const man = amount / 10000;
    if (man < 100) {
        // 1만~99만: 소수 1자리 (0이면 정수)
        const formatted = man % 1 === 0 ? `${Math.round(man)}` : `${Math.round(man * 10) / 10}`;
        return `${formatted}만`;
    }
    return `${Math.round(man)}만`;
}

interface StatMiniProps {
    icon: string;
    value: string | number;
    label: string;
    sub?: string;
    color: string;
    onClick?: () => void;
}

function StatMini({ icon, value, label, sub, color, onClick }: StatMiniProps) {
    return (
        <div
            className={`glass-card p-4 relative overflow-hidden group hover:shadow-lg transition-shadow duration-300 ${onClick ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]' : ''}`}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
        >
            <div className={`absolute -top-4 -right-4 w-16 h-16 rounded-full opacity-10 ${color}`} />
            <div className="flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <div>
                    <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500">{label}</p>
                    {sub && <p className="text-[10px] text-surface-500 dark:text-surface-500 mt-0.5">{sub}</p>}
                </div>
            </div>
            {onClick && <span className="absolute bottom-1 right-2 text-[9px] text-surface-400 dark:text-surface-500 opacity-0 group-hover:opacity-100 transition-opacity">클릭하여 보기 →</span>}
        </div>
    );
}

export default function AnalyticsDashboard() {
    const {
        loading, rangeMonths, setRangeMonths,
        monthlyTrend, driverComparison, vehicleUtilization, heatmapData,
        fuelEfficiency, maintenanceCostAnalysis, anomalies, recommendations,
        costTrend, totalFuelCost, totalHipassCost, totalMaintenanceCost, totalOperatingCost,
        totalLogs, totalVehicles, totalMembers,
    } = useAnalytics();

    const [activeTab, setActiveTab] = useState('trend');

    // 총 운행 거리 계산
    const totalDistance = monthlyTrend.reduce((s, m) => s + (m.distance || 0), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center animate-fade-in">
                    <div className="w-8 h-8 spinner mx-auto mb-3" />
                    <p className="text-surface-400 dark:text-surface-500 text-sm">분석 데이터를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto animate-fade-in">
            {/* 헤더 */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">운행 분석</h1>
                <div className="flex items-center gap-2">
                    {RANGE_OPTIONS.map(op => (
                        <button
                            key={op.value}
                            onClick={() => setRangeMonths(op.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${rangeMonths === op.value
                                ? 'bg-primary-600 dark:bg-primary-700 text-white shadow-md'
                                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                                }`}
                        >
                            {op.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 요약 통계 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                <StatMini icon="📊" value={`${totalLogs}건`} label="분석 기간 운행" sub={totalDistance > 0 ? `총 ${totalDistance.toLocaleString()}km` : undefined} color="bg-primary-400 dark:bg-primary-600/50" />
                <StatMini icon="🚗" value={totalVehicles} label="등록 차량" sub={`직원 ${totalMembers}명`} color="bg-accent-400 dark:bg-accent-600/50" />
                <StatMini icon="⛽" value={formatCost(totalFuelCost)} label="총 주유비" sub={totalFuelCost > 0 ? `${totalFuelCost.toLocaleString()}원` : undefined} color="bg-amber-400 dark:bg-amber-600/50" />
                <StatMini icon="🛣️" value={formatCost(totalHipassCost)} label="하이패스 충전" sub={totalHipassCost > 0 ? `${totalHipassCost.toLocaleString()}원` : undefined} color="bg-purple-400 dark:bg-purple-600/50" />
                <StatMini icon="💡" value={recommendations.length} label="최적화 추천" sub="연료·정비·가동률 개선 제안" color="bg-rose-400 dark:bg-rose-600/50" onClick={() => setActiveTab('cost')} />
            </div>

            {/* 탭 */}
            <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1 mb-6">
                {[
                    { key: 'trend', label: '트렌드 분석' },
                    { key: 'cost', label: '비용 최적화' },
                ].map(tab => (
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

            {/* 콘텐츠 */}
            <Suspense fallback={<div className="p-10 text-center text-surface-400 dark:text-surface-500 spinner mx-auto">분석 차트를 불러오는 중...</div>}>
                {activeTab === 'trend' ? (
                    <TrendCharts
                        monthlyTrend={monthlyTrend}
                        driverComparison={driverComparison}
                        vehicleUtilization={vehicleUtilization}
                        heatmapData={heatmapData}
                        costTrend={costTrend}
                    />
                ) : (
                    <CostOptimization
                        fuelEfficiency={fuelEfficiency}
                        maintenanceCostAnalysis={maintenanceCostAnalysis}
                        anomalies={anomalies}
                        recommendations={recommendations}
                        costTrend={costTrend}
                        totalFuelCost={totalFuelCost}
                        totalHipassCost={totalHipassCost}
                        totalMaintenanceCost={totalMaintenanceCost}
                        totalOperatingCost={totalOperatingCost}
                    />
                )}
            </Suspense>
        </div>
    );
}
