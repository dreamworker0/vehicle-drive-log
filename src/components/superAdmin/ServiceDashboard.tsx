import { lazy, Suspense } from 'react';
import useServiceDashboard from '../../hooks/useServiceDashboard';
import { ORG_PAGE_SIZE } from './dashboard/dashboardUtils';
import {
    DashboardOverviewCards,
    DashboardMonthlyMetrics,
    DashboardNotificationStats,
    DashboardOrgTable,
} from './dashboard';

const DashboardFunnelChart = lazy(() => import('./dashboard/DashboardFunnelChart'));
const DashboardChartSection = lazy(() => import('./dashboard/DashboardChartSection'));
const DashboardDriveAnalysis = lazy(() => import('./dashboard/DashboardDriveAnalysis'));

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리 + 고도화 인사이트
 */
export default function ServiceDashboard() {
    const {
        loading,
        stats,
        monthlyStats,
        weeklyActiveRate,
        onboardingStats,
        funnelData,
        dailyActiveOrgStats,
        dailyActiveUserStats,
        firstEmployeeStats,
        firstEmployeeDist,
        firstEmployeeTrend,
        inputMethodStats,
        quickDriveStats,
        quickDriveRatio,
        recommendationStats,
        recommendationRatio,
        favoriteUserRatio,
        favoriteLogRatio,
        favoriteStats,
        orgSizeDistribution,
        fuelTypeStats,
        vehicleTypeStats,
        vehicleModelStats,
        hipassRatio,
        calendarSyncRatio,
        calendarTopOrgs,
        calendarSyncOrgCount,
        hipassTopOrgs,
        fuelStats,
        hipassStats,
        dailyFuelCost,
        dailyHipassAmount,
        heatmapData,
        hourlyStats,
        monthlyGrowth,
        dailyAvgDuration,
        hourlyAvgDuration,
        orgAvgDuration,
        notifSummary,
        dailyNotifStats,
        notifTypeStats,
        topOrgs,
        sortedOrgs,
        orgPage,
        setOrgPage,
        sortKey,
        sortDir,
        handleSort,
        sortIndicator,
        refreshServerStats,
    } = useServiceDashboard();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">서비스 운영 대시보드</h1>
                <button onClick={() => refreshServerStats()} className="btn-ghost text-sm flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    전체 통계 갱신
                </button>
            </div>

            {/* ── 서비스 개요 카드 ── */}
            {stats && <DashboardOverviewCards stats={stats} />}

            {/* ── 월간 운영 지표 ── */}
            {monthlyStats && (
                <DashboardMonthlyMetrics
                    monthlyStats={monthlyStats}
                    weeklyActiveRate={weeklyActiveRate}
                    onboardingStats={onboardingStats}
                />
            )}

            <Suspense fallback={
                <div className="flex items-center justify-center py-20 text-surface-400">
                    <div className="w-8 h-8 spinner mx-auto mb-3" />
                    <p className="text-sm">차트 데이터를 불러오는 중...</p>
                </div>
            }>
                {/* ── 기관 활성화 퍼널 ── */}
                <DashboardFunnelChart funnelData={funnelData} />

                {/* ── 차트 섹션 (일별 기관/DAU/입력방식/차량 분포/주유·하이패스) ── */}
                <DashboardChartSection
                    dailyActiveOrgStats={dailyActiveOrgStats}
                    dailyActiveUserStats={dailyActiveUserStats}
                    firstEmployeeStats={firstEmployeeStats}
                    firstEmployeeDist={firstEmployeeDist}
                    firstEmployeeTrend={firstEmployeeTrend}
                    inputMethodStats={inputMethodStats}
                    quickDriveStats={quickDriveStats}
                    quickDriveRatio={quickDriveRatio}
                    recommendationStats={recommendationStats}
                    recommendationRatio={recommendationRatio}
                    favoriteStats={favoriteStats}
                    favoriteRatio={favoriteLogRatio}
                    favoriteUserRatio={favoriteUserRatio}
                    orgSizeDistribution={orgSizeDistribution}
                    fuelTypeStats={fuelTypeStats}
                    vehicleTypeStats={vehicleTypeStats}
                    vehicleModelStats={vehicleModelStats}
                    hipassRatio={hipassRatio}
                    calendarSyncRatio={calendarSyncRatio}
                    calendarTopOrgs={calendarTopOrgs}
                    calendarSyncOrgs={calendarSyncOrgCount}
                    hipassTopOrgs={hipassTopOrgs}
                    fuelStats={fuelStats}
                    hipassStats={hipassStats}
                    dailyFuelCost={dailyFuelCost}
                    dailyHipassAmount={dailyHipassAmount}
                />

                {/* ── 운행 분석 (시간대/히트맵/주행시간) ── */}
                <DashboardDriveAnalysis
                    heatmapData={heatmapData}
                    hourlyStats={hourlyStats}
                    monthlyGrowth={monthlyGrowth}
                    dailyAvgDuration={dailyAvgDuration}
                    hourlyAvgDuration={hourlyAvgDuration}
                    orgAvgDuration={orgAvgDuration}
                />
            </Suspense>

            {/* ── 알림 활용 현황 ── */}
            {notifSummary && (
                <DashboardNotificationStats
                    notifSummary={notifSummary}
                    dailyNotifStats={dailyNotifStats}
                    notifTypeStats={notifTypeStats}
                />
            )}

            {/* ── 기관 활성도 테이블 + 지도 ── */}
            <DashboardOrgTable
                topOrgs={topOrgs}
                sortedOrgs={sortedOrgs}
                orgPage={orgPage}
                setOrgPage={setOrgPage}
                sortKey={sortKey}
                sortDir={sortDir}
                handleSort={handleSort}
                sortIndicator={sortIndicator}
            />
        </div>
    );
}
