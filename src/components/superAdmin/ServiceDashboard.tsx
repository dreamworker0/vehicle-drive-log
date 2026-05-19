/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, Suspense, useState } from 'react';
import useServiceDashboard from '../../hooks/useServiceDashboard';
import { ORG_PAGE_SIZE } from './dashboard/dashboardUtils';
import {
    DashboardOverviewCards,
    DashboardMonthlyMetrics,
    DashboardOrgTable,
} from './dashboard';
import OrgSearchDropdown from './OrgSearchDropdown';

const DashboardFunnelChart = lazy(() => import('./dashboard/DashboardFunnelChart'));
const DashboardChartSection = lazy(() => import('./dashboard/DashboardChartSection'));
const ChartOrgTrend = lazy(() => import('./dashboard/ChartOrgTrend'));
const ChartFirstEmployee = lazy(() => import('./dashboard/ChartFirstEmployee'));
const DashboardDriveAnalysis = lazy(() => import('./dashboard/DashboardDriveAnalysis'));
const DashboardNotificationStats = lazy(() => import('./dashboard/DashboardNotificationStats'));

type TabType = 'overview' | 'analysis' | 'experience';

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리 + 고도화 인사이트
 */
export default function ServiceDashboard() {
    const [activeTab, setActiveTab] = useState<TabType>('analysis');
    const [selectedOrgId, setSelectedOrgId] = useState<string>('ALL');

    const {
        loading,
        summary,
        timeSeries,
        rankings,
        external,
        sortedOrgs,
        ui,
        actions
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
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 shrink-0">서비스 운영 대시보드</h1>
                    <OrgSearchDropdown 
                        selectedOrgId={selectedOrgId} 
                        onChange={setSelectedOrgId} 
                        orgs={rankings.topOrgs || []} 
                    />
                </div>
                <div className="flex flex-col items-end gap-1">
                    <button onClick={() => actions.refreshServerStats()} className="btn-ghost w-fit text-sm flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                        </svg>
                        전체 통계 갱신
                    </button>
                    {summary.lastUpdatedAt && (
                        <div className="text-xs text-surface-500 dark:text-surface-400">
                            최근 갱신: {new Date(summary.lastUpdatedAt).toLocaleString('ko-KR', {
                                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                            })}
                        </div>
                    )}
                </div>
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
                    {summary.stats && <DashboardOverviewCards stats={summary.stats as any} />}

                    {timeSeries.dailyActiveOrgStats && (
                        <Suspense fallback={
                            <div className="flex items-center justify-center py-20 text-surface-400">
                                <div className="w-8 h-8 spinner mx-auto mb-3" />
                            </div>
                        }>
                            <ChartOrgTrend dailyActiveOrgStats={timeSeries.dailyActiveOrgStats} />
                        </Suspense>
                    )}

                    {summary.monthlyStats && (
                        <DashboardMonthlyMetrics
                            monthlyStats={summary.monthlyStats as any}
                            weeklyActiveRate={summary.weeklyActiveRate || { active: 0, total: 0 }}
                            onboardingStats={summary.onboardingStats || { total: 0, completed: 0, rate: 0 }}
                        />
                    )}

                    {summary.firstEmployeeStats && (
                        <Suspense fallback={
                            <div className="flex items-center justify-center py-10 text-surface-400">
                                <div className="w-6 h-6 spinner" />
                            </div>
                        }>
                            <ChartFirstEmployee
                                firstEmployeeStats={summary.firstEmployeeStats as any}
                                firstEmployeeDist={summary.firstEmployeeDist || []}
                                firstEmployeeTrend={summary.firstEmployeeTrend || []}
                            />
                        </Suspense>
                    )}

                    <Suspense fallback={
                        <div className="flex items-center justify-center py-20 text-surface-400">
                            <div className="w-8 h-8 spinner mx-auto mb-3" />
                        </div>
                    }>
                        <DashboardFunnelChart funnelData={rankings.funnelData || []} />
                    </Suspense>

                    <DashboardOrgTable
                        topOrgs={rankings.topOrgs || []}
                        sortedOrgs={sortedOrgs}
                        orgPage={ui.orgPage}
                        setOrgPage={ui.setOrgPage}
                        sortKey={ui.sortKey}
                        sortDir={ui.sortDir}
                        handleSort={ui.handleSort}
                        sortIndicator={ui.sortIndicator}
                        onRefresh={actions.refreshServerStats}
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
                            dailyActiveUserStats={timeSeries.dailyActiveUserStats || []}
                            firstEmployeeStats={summary.firstEmployeeStats as any || null}
                            firstEmployeeDist={summary.firstEmployeeDist || []}
                            firstEmployeeTrend={summary.firstEmployeeTrend || []}
                            inputMethodStats={timeSeries.inputMethodStats || []}
                            quickDriveStats={timeSeries.quickDriveStats || []}
                            quickDriveRatio={timeSeries.quickDriveRatio || { total: 0, quick: 0, regular: 0, rate: 0 }}
                            recommendationStats={timeSeries.recommendationStats || []}
                            recommendationRatio={timeSeries.recommendationRatio || { total: 0, recommendation: 0, normal: 0, rate: 0 }}
                            reservationTypeStats={timeSeries.reservationTypeStats || []}
                            reservationTypeRatio={timeSeries.reservationTypeRatio || { total: 0, single: 0, multiDay: 0, recurring: 0, singleRate: 0, multiDayRate: 0, recurringRate: 0 }}
                            futureReservationTypeStats={timeSeries.futureReservationTypeStats || []}
                            futureReservationTypeRatio={timeSeries.futureReservationTypeRatio || { total: 0, single: 0, multiDay: 0, recurring: 0, singleRate: 0, multiDayRate: 0, recurringRate: 0 }}
                            favoriteStats={timeSeries.favoriteStats || []}
                            favoriteRatio={timeSeries.favoriteLogRatio || { total: 0, favorite: 0, normal: 0, rate: 0 }}
                            favoriteUserRatio={summary.favoriteUserRatio || { total: 0, withFavorite: 0, rate: 0 }}
                            orgSizeDistribution={summary.orgSizeDistribution || []}
                            fuelTypeStats={summary.fuelTypeStats || []}
                            vehicleTypeStats={summary.vehicleTypeStats || []}
                            vehicleModelStats={summary.vehicleModelStats || []}
                            vehicleModelStatsActive={summary.vehicleModelStatsActive || []}
                            vehicleModelStatsRetired={summary.vehicleModelStatsRetired || []}
                            hipassRatio={summary.hipassRatio || { withHipass: 0, withoutHipass: 0 }}
                            calendarSyncRatio={summary.calendarSyncRatio || { sync: 0, notSync: 0 }}
                            calendarTopOrgs={summary.calendarTopOrgs || []}
                            calendarSyncOrgs={summary.calendarSyncOrgs || 0}
                            hipassTopOrgs={summary.hipassTopOrgs || []}
                            fuelStats={external.fuelStats}
                            hipassStats={external.hipassStats}
                            dailyFuelCost={external.dailyFuelCost}
                            dailyHipassAmount={external.dailyHipassAmount}
                        />

                        <DashboardDriveAnalysis
                            heatmapData={timeSeries.heatmapData || { grid: Array.from({ length: 7 }, () => Array(24).fill(0)), maxCount: 1 }}
                            hourlyStats={timeSeries.hourlyStats || []}
                            monthlyGrowth={summary.monthlyGrowth || []}
                            dailyAvgDuration={timeSeries.dailyAvgDuration || []}
                            hourlyAvgDuration={timeSeries.hourlyAvgDuration || []}
                            orgAvgDuration={rankings.orgAvgDuration || []}
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
                    {summary.stats && summary.stats.themeStats && (() => {
                        const s = summary.stats as NonNullable<typeof summary.stats>;
                        if(!s.themeStats) return null;
                        const darkRatio = Math.round((s.themeStats.dark / (s.totalUsers || 1)) * 100) || 0;
                        const lightRatio = Math.round(((s.themeStats.light + s.themeStats.none) / (s.totalUsers || 1)) * 100) || 0;
                        return (
                            <div className="glass-card p-5">
                                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 flex items-center gap-2">
                                    <span className="text-xl">🌗</span> 전체 테마 사용 현황 (총 {s.totalUsers}명)
                                </h2>
                                
                                {/* 인사이트 메시지 */}
                                <div className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg text-sm text-surface-700 dark:text-surface-300 border border-surface-100 dark:border-surface-700">
                                    <p className="font-medium text-primary-600 dark:text-primary-400 mb-1">📊 Insight</p>
                                    <p>현재 사용자 중 라이트 모드(기본값 포함) 이용자가 <span className="font-bold">{lightRatio}%</span>로 우세합니다. 주로 주간에 앱을 사용하는 서비스 특성이 반영되어 있습니다.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row items-center gap-5 text-sm font-medium">
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2">
                                            다크 모드 사용하는 인원: <span className="font-bold text-surface-900 dark:text-white">{s.themeStats.dark}명 ({darkRatio}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-slate-700 dark:bg-slate-300 h-full rounded-full transition-all duration-500" style={{ width: `${darkRatio}%` }} />
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2">
                                            라이트 모드 사용하는 인원: <span className="font-bold text-surface-900 dark:text-white">{s.themeStats.light + s.themeStats.none}명 ({lightRatio}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-400 dark:bg-amber-500 h-full rounded-full transition-all duration-500" style={{ width: `${lightRatio}%` }} />
                                        </div>
                                    </div>
                                </div>
                                {s.themeStats.none > 0 && (
                                    <p className="text-xs text-surface-400 mt-4">* 기본 테마 유지 사용자({s.themeStats.none}명)는 자동 라이트 모드로 간주되어 합산되었습니다.</p>
                                )}
                            </div>
                        );
                    })()}

                    {/* ── 웰컴(초기 안내) 화면 활용 현황 ── */}
                    {summary.stats && summary.stats.welcomeStats && (() => {
                        const s = summary.stats as NonNullable<typeof summary.stats>;
                        if(!s.welcomeStats) return null;
                        const totalWelcomes = s.welcomeStats.dismissed + s.welcomeStats.notDismissed;
                        return (
                            <div className="glass-card p-5">
                                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 flex items-center gap-2">
                                    <span className="text-xl">👋</span> 웰컴 화면 진입 및 완료율 (총 {totalWelcomes}명 대기열)
                                </h2>

                                {/* 인사이트 메시지 */}
                                <div className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg text-sm text-surface-700 dark:text-surface-300 border border-surface-100 dark:border-surface-700">
                                    <p className="font-medium text-emerald-600 dark:text-emerald-400 mb-1">💡 Onboarding Insight</p>
                                    <p>초기 온보딩(안내) 화면을 모두 읽고 시작한 비율은 <span className="font-bold">{s.welcomeStats.rate}%</span>입니다. 완료 비율이 지나치게 낮다면 안내 화면의 뎁스를 줄여볼 필요가 있습니다.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row items-center gap-5 text-sm font-medium">
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2 flex justify-between">
                                            <span>안내 읽기 완료 (온보딩 달성)</span>
                                            <span className="font-bold text-surface-900 dark:text-white">{s.welcomeStats.dismissed}명 ({s.welcomeStats.rate}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${s.welcomeStats.rate}%` }} />
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <p className="text-surface-600 dark:text-surface-300 mb-2 flex justify-between">
                                            <span>닫지 않음 (최초 접속 대기 중 등)</span>
                                            <span className="font-bold text-surface-900 dark:text-white">{s.welcomeStats.notDismissed}명 ({100 - s.welcomeStats.rate}%)</span>
                                        </p>
                                        <div className="w-full bg-surface-200 dark:bg-surface-700 h-2.5 rounded-full overflow-hidden">
                                            <div className="bg-orange-400 h-full rounded-full transition-all duration-500" style={{ width: `${100 - s.welcomeStats.rate}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {external.notifSummary && (
                        <Suspense fallback={
                            <div className="flex items-center justify-center py-10 text-surface-400">
                                <div className="w-6 h-6 spinner" />
                            </div>
                        }>
                            <DashboardNotificationStats
                                notifSummary={external.notifSummary}
                                dailyNotifStats={external.dailyNotifStats || []}
                                notifTypeStats={external.notifTypeStats || []}
                            />
                        </Suspense>
                    )}
                </div>
            )}
        </div>
    );
}
