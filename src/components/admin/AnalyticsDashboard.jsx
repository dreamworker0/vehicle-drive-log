/**
 * AnalyticsDashboard — 고도화 분석 대시보드
 * 트렌드 분석 + 비용 최적화 탭 구성
 */
import { useState } from 'react';
import useAnalytics from '../../hooks/useAnalytics';
import TrendCharts from './TrendCharts';
import CostOptimization from './CostOptimization';

const RANGE_OPTIONS = [
    { value: 3, label: '3개월' },
    { value: 6, label: '6개월' },
    { value: 12, label: '1년' },
];

function StatMini({ icon, value, label, color }) {
    return (
        <div className="glass-card p-4 relative overflow-hidden group hover:shadow-lg transition-shadow duration-300">
            <div className={`absolute -top-4 -right-4 w-16 h-16 rounded-full opacity-10 ${color}`} />
            <div className="flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <div>
                    <p className="text-xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
                    <p className="text-xs text-surface-400">{label}</p>
                </div>
            </div>
        </div>
    );
}

export default function AnalyticsDashboard() {
    const {
        loading, rangeMonths, setRangeMonths,
        monthlyTrend, driverComparison, vehicleUtilization, heatmapData,
        fuelEfficiency, maintenanceCostAnalysis, anomalies, recommendations,
        totalLogs, totalVehicles, totalMembers,
    } = useAnalytics();

    const [activeTab, setActiveTab] = useState('trend');

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center animate-fade-in">
                    <div className="w-8 h-8 spinner mx-auto mb-3" />
                    <p className="text-surface-400 text-sm">분석 데이터를 불러오는 중...</p>
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
                                ? 'bg-primary-600 text-white shadow-md'
                                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                                }`}
                        >
                            {op.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 요약 통계 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatMini icon="📊" value={totalLogs} label="분석 기간 운행" color="bg-primary-400" />
                <StatMini icon="🚗" value={totalVehicles} label="등록 차량" color="bg-accent-400" />
                <StatMini icon="👤" value={totalMembers} label="등록 직원" color="bg-amber-400" />
                <StatMini icon="💡" value={recommendations.length} label="최적화 추천" color="bg-purple-400" />
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
            {activeTab === 'trend' ? (
                <TrendCharts
                    monthlyTrend={monthlyTrend}
                    driverComparison={driverComparison}
                    vehicleUtilization={vehicleUtilization}
                    heatmapData={heatmapData}
                />
            ) : (
                <CostOptimization
                    fuelEfficiency={fuelEfficiency}
                    maintenanceCostAnalysis={maintenanceCostAnalysis}
                    anomalies={anomalies}
                    recommendations={recommendations}
                />
            )}
        </div>
    );
}
