import { lazy, Suspense, useState } from 'react';
import useServiceDashboard from '../../hooks/useServiceDashboard';
import { ORG_PAGE_SIZE } from './dashboard/dashboardUtils';
import {
    DashboardOverviewCards,
    DashboardMonthlyMetrics,
    DashboardOrgTable,
} from './dashboard';

const DashboardFunnelChart = lazy(() => import('./dashboard/DashboardFunnelChart'));
const DashboardChartSection = lazy(() => import('./dashboard/DashboardChartSection'));
const ChartFirstEmployee = lazy(() => import('./dashboard/ChartFirstEmployee'));
const DashboardDriveAnalysis = lazy(() => import('./dashboard/DashboardDriveAnalysis'));
const DashboardNotificationStats = lazy(() => import('./dashboard/DashboardNotificationStats'));

type TabType = 'overview' | 'analysis' | 'experience';

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리 + 고도화 인사이트
 */
export default function ServiceDashboard() {
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [selectedOrgId, setSelectedOrgId] = useState<string>('ALL');

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
        reservationTypeStats,
        reservationTypeRatio,
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
    } = useServiceDashboard(selectedOrgId);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">서비스 운영 대시보드</h1>
                    <select
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        className="p-1.5 text-sm font-medium rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 outline-none focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="ALL">전체 기관 통계</option>
                        {topOrgs.map(org => (
                            <option key={org.id} value={org.id}>
                                {org.name}
                            </option>
                        ))}
                    </select>
                </div>
                <button onClick={() => refreshServerStats()} className="btn-ghost w-fit text-sm flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    전체 통계 갱신
                </button>
            </div>

            {/* ── 탭 네비게이션 ── */}
            <div className="flex space-x-1 bg-surface-100 dark:bg-surface-800 p-1.5 rounded-xl glass-card overflow-x-auto hide-scrollbar">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`flex-1 min-w-[100px] py-2.5 text-sm font-medium rounded-lg transition-all ${
                        activeTab === 'overview'
                            ? 'bg-white dark:bg-surface-700 shadow text-primary-600 dark:text-primary-400'
                            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
                    }`}
                >
                    운영 요약
                </button>
                <button
                    onClick={() => setActiveTab('analysis')}
                    className={`flex-1 min-w-[100px] py-2.5 text-sm font-medium rounded-lg transition-all ${
                        activeTab === 'analysis'
                            ? 'bg-white dark:bg-surface-700 shadow text-primary-600 dark:text-primary-400'
                            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
                    }`}
                >
                    운행 분석
                </button>
                <button
                    onClick={() => setActiveTab('experience')}
                    className={`flex-1 min-w-[100px] py-2.5 text-sm font-medium rounded-lg transition-all ${
                        activeTab === 'experience'
                            ? 'bg-white dark:bg-surface-700 shadow text-primary-600 dark:text-primary-400'
                            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
                    }`}
                >
                    사용자 경험
                </button>
            </div>

            {/* =========================================
                탭 1: 운영 요약 (Overview)
            ========================================= */}
            {activeTab === 'overview' && (
                <div className="space-y-6 animate-fade-in">
                    {stats && <DashboardOverviewCards stats={stats} />}

                    {monthlyStats && (
                        <DashboardMonthlyMetrics
                            monthlyStats={monthlyStats}
                            weeklyActiveRate={weeklyActiveRate}
                            onboardingStats={onboardingStats}
                        />
                    )}

                    {firstEmployeeStats && (
                        <Suspense fallback={
                            <div className="flex items-center justify-center py-10 text-surface-400">
                                <div className="w-6 h-6 spinner" />
                            </div>
                        }>
                            <ChartFirstEmployee
                                firstEmployeeStats={firstEmployeeStats}
                                firstEmployeeDist={firstEmployeeDist}
                                firstEmployeeTrend={firstEmployeeTrend}
                            />
                        </Suspense>
                    )}

                    <Suspense fallback={
                        <div className="flex items-center justify-center py-20 text-surface-400">
                            <div className="w-8 h-8 spinner mx-auto mb-3" />
                        </div>
                    }>
                        <DashboardFunnelChart funnelData={funnelData} />
                    </Suspense>

                    <DashboardOrgTable
                        topOrgs={topOrgs}
                        sortedOrgs={sortedOrgs}
                        orgPage={orgPage}
                        setOrgPage={setOrgPage}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        handleSort={handleSort}
                        sortIndicator={sortIndicator}
                        onRefresh={refreshServerStats}
                    />
                </div>
            )}

            {/* =========================================
                탭 2: 운행 분석 (Drive Analysis)
            ========================================= */}
            {activeTab === 'analysis' && (
                <div className="space-y-6 animate-fade-in">
                    <Suspense fallback={
                        <div className="flex items-center justify-center py-20 text-surface-400">
                            <div className="w-8 h-8 spinner mx-auto mb-3" />
                            <p className="text-sm">차트 데이터를 불러오는 중...</p>
                        </div>
                    }>
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
                            reservationTypeStats={reservationTypeStats}
                            reservationTypeRatio={reservationTypeRatio}
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

                        <DashboardDriveAnalysis
                            heatmapData={heatmapData}
                            hourlyStats={hourlyStats}
                            monthlyGrowth={monthlyGrowth}
                            dailyAvgDuration={dailyAvgDuration}
                            hourlyAvgDuration={hourlyAvgDuration}
                            orgAvgDuration={orgAvgDuration}
                        />
                    </Suspense>
                </div>
            )}

            {/* =========================================
                탭 3: 사용자 경험 현황 (User Experience)
            ========================================= */}
            {activeTab === 'experience' && (
                <div className="space-y-6 animate-fade-in">
                    {/* ── 테마 사용 현황 ── */}
                    {stats && stats.themeStats && (() => {
                        const darkRatio = Math.round((stats.themeStats.dark / (stats.totalUsers || 1)) * 100) || 0;
                        const lightRatio = Math.round(((stats.themeStats.light + stats.themeStats.none) / (stats.totalUsers || 1)) * 100) || 0;
                        return (
                            <div className="glass-card p-5">
                                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 flex items-center gap-2">
                                    <span className="text-xl">🌗</span> 전체 테마 사용 현황 (총 {stats.totalUsers}명)
                                </h2>
                                
                                {/* 인사이트 메시지 */}
                                <div className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg text-sm text-surface-700 dark:text-surface-300 border border-surface-100 dark:border-surface-700">
                                    <p className="font-medium text-primary-600 dark:text-primary-400 mb-1">📊 Insight</p>
                                    <p>현재 사용자 중 라이트 모드(기본값 포함) 이용자가 <span className="font-bold">{lightRatio}%</span>로 우세합니다. 주로 주간에 앱을 사용하는 서비스 특성이 반영되어 있습니다.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row items-center gap-5 text-sm font-medium">
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2">
                                            다크 모드 사용하는 인원: <span className="font-bold text-surface-900 dark:text-white">{stats.themeStats.dark}명 ({darkRatio}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-slate-700 dark:bg-slate-300 h-full rounded-full transition-all duration-500" style={{ width: `${darkRatio}%` }} />
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2">
                                            라이트 모드 사용하는 인원: <span className="font-bold text-surface-900 dark:text-white">{stats.themeStats.light + stats.themeStats.none}명 ({lightRatio}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-400 dark:bg-amber-500 h-full rounded-full transition-all duration-500" style={{ width: `${lightRatio}%` }} />
                                        </div>
                                    </div>
                                </div>
                                {stats.themeStats.none > 0 && (
                                    <p className="text-xs text-surface-400 mt-4">* 기본 테마 유지 사용자({stats.themeStats.none}명)는 자동 라이트 모드로 간주되어 합산되었습니다.</p>
                                )}
                            </div>
                        );
                    })()}

                    {/* ── 웰컴(초기 안내) 화면 활용 현황 ── */}
                    {stats && stats.welcomeStats && (() => {
                        const totalWelcomes = stats.welcomeStats.dismissed + stats.welcomeStats.notDismissed;
                        return (
                            <div className="glass-card p-5">
                                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 flex items-center gap-2">
                                    <span className="text-xl">👋</span> 웰컴 화면 진입 및 완료율 (총 {totalWelcomes}명 대기열)
                                </h2>

                                {/* 인사이트 메시지 */}
                                <div className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg text-sm text-surface-700 dark:text-surface-300 border border-surface-100 dark:border-surface-700">
                                    <p className="font-medium text-emerald-600 dark:text-emerald-400 mb-1">💡 Onboarding Insight</p>
                                    <p>초기 온보딩(안내) 화면을 모두 읽고 시작한 비율은 <span className="font-bold">{stats.welcomeStats.rate}%</span>입니다. 완료 비율이 지나치게 낮다면 안내 화면의 뎁스를 줄여볼 필요가 있습니다.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row items-center gap-5 text-sm font-medium">
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2 flex justify-between">
                                            <span>안내 읽기 완료 (온보딩 달성)</span>
                                            <span className="font-bold text-surface-900 dark:text-white">{stats.welcomeStats.dismissed}명 ({stats.welcomeStats.rate}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${stats.welcomeStats.rate}%` }} />
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2 flex justify-between">
                                            <span>닫지 않음 (최초 접속 대기 중 등)</span>
                                            <span className="font-bold text-surface-900 dark:text-white">{stats.welcomeStats.notDismissed}명 ({100 - stats.welcomeStats.rate}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-orange-400 h-full rounded-full transition-all duration-500" style={{ width: `${100 - stats.welcomeStats.rate}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {notifSummary && (
                        <Suspense fallback={
                            <div className="flex items-center justify-center py-10 text-surface-400">
                                <div className="w-6 h-6 spinner" />
                            </div>
                        }>
                            <DashboardNotificationStats
                                notifSummary={notifSummary}
                                dailyNotifStats={dailyNotifStats}
                                notifTypeStats={notifTypeStats}
                            />
                        </Suspense>
                    )}
                </div>
            )}
        </div>
    );
}
