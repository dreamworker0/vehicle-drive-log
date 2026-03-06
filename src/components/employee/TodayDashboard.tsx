/**
 * TodayDashboard — 오늘의 운행 페이지
 * 로직은 useTodayDashboard 훅 사용
 * 서브 컴포넌트: WelcomeGuide, ReservationCard, WeekReservationList
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTodayDashboard from '../../hooks/useTodayDashboard';
import { SkeletonCard, SkeletonBox } from '../common/Skeleton';
import WelcomeGuide from './WelcomeGuide';
import ReservationCard from './ReservationCard';
import WeekReservationList from './WeekReservationList';

export default function TodayDashboard() {
    const {
        vehicles, loading, startingId, cancellingId,
        myReservations, weekGrouped, todayLabel,
        upcomingAlerts, incompleteAlerts, hasActiveDrive,
        handleStartDrive, handleStartNavigation,
        handleCancelWeekReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
        recommendedVehicle,
    } = useTodayDashboard();
    const navigate = useNavigate();
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

    // 웰컴 가이드 (첫 방문 시 1회 표시)
    const [showWelcome, setShowWelcome] = useState(() => {
        try { return localStorage.getItem('employee-welcome-dismissed') !== 'true'; } catch { return true; }
    });
    const dismissWelcome = () => {
        setShowWelcome(false);
        try { localStorage.setItem('employee-welcome-dismissed', 'true'); } catch { /* noop */ }
    };

    if (loading) {
        return (
            <div className="max-w-lg mx-auto animate-fade-in">
                <SkeletonBox className="h-6 w-32 mb-1" />
                <SkeletonBox className="h-4 w-48 mb-5" />
                <div className="space-y-3">
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <div className="flex items-baseline gap-2 mb-5">
                <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">오늘의 운행</h1>
                <p className="text-sm text-surface-400">{todayLabel}</p>
            </div>

            {/* 첫 방문 웰컴 가이드 */}
            {showWelcome && <WelcomeGuide onDismiss={dismissWelcome} />}

            {/* 임박 예약 알림 배너 */}
            {upcomingAlerts.filter((r: any) => !dismissedAlerts.has(r.id)).length > 0 && (
                <div className="mb-4 space-y-2">
                    {upcomingAlerts.filter((r: any) => !dismissedAlerts.has(r.id)).map((r: any) => (
                        <div key={r.id} className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 rounded-xl p-3 flex items-center gap-3 animate-fade-in">
                            <span className="text-xl">⏰</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                                    {r.vehicleName} 예약이 곧 시작됩니다
                                </p>
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    {r.startTime} 출발{r.destination ? ` · ${r.destination}` : ''}
                                </p>
                            </div>
                            <button
                                onClick={() => setDismissedAlerts(prev => new Set([...prev, r.id]))}
                                className="p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors flex-shrink-0"
                                title="알림 닫기"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* 미작성 알림 */}
            {incompleteAlerts.length > 0 && (
                <div className="mb-4 space-y-2">
                    {incompleteAlerts.map((alert: any, idx: number) => (
                        <div key={alert.id || idx} className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 rounded-xl p-3 flex items-center gap-3 animate-fade-in">
                            <span className="text-xl">📝</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-red-800 dark:text-red-200">운행일지 미작성</p>
                                <p className="text-xs text-red-600 dark:text-red-400 truncate">
                                    {`${alert.vehicleName || ''} · ${alert.date || ''} ${alert.startTime || ''}~${alert.endTime || ''}`}
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    const vehicle = vehicles.find((v: any) => v.id === alert.vehicleId);
                                    navigate('/employee/drive-log', {
                                        state: {
                                            reservationId: alert.id,
                                            vehicleId: alert.vehicleId,
                                            vehicleName: alert.vehicleName,
                                            purpose: alert.purpose || '',
                                            destination: alert.destination || '',
                                            currentKm: vehicle?.currentKm || 0,
                                            actualStartTime: alert.actualStartTime || '',
                                        },
                                    });
                                }}
                                className="btn-sm text-xs whitespace-nowrap bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                            >
                                작성하기
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* 내 예약 */}
            {myReservations.length > 0 && (
                <div className="mb-6">
                    <h2 className="text-sm font-semibold text-surface-600 dark:text-surface-400 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary-500" />
                        내 예약
                    </h2>
                    <div className="space-y-2">
                        {myReservations.map((res: any) => {
                            const vehicle = vehicles.find((v: any) => v.id === res.vehicleId);
                            return (
                                <ReservationCard
                                    key={res.id}
                                    reservation={res}
                                    vehicle={vehicle}
                                    isInProgress={res.status === 'in_progress'}
                                    disabled={hasActiveDrive && res.status !== 'in_progress'}
                                    startingId={startingId}
                                    onStartDrive={handleStartDrive}
                                    onStartNavigation={handleStartNavigation}
                                    onArrival={navigateToArrival}
                                />
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 예약이 없을 때 안내 */}
            {myReservations.length === 0 && (
                <div className="glass-card px-4 py-3 border-l-4 border-l-primary-400">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-sm flex-shrink-0">📋</span>
                            <div className="min-w-0">
                                <p className="font-medium text-surface-800 dark:text-surface-200 text-sm">오늘 예약이 없습니다</p>
                                <p className="text-xs text-surface-500 dark:text-surface-400">새 예약을 등록해보세요</p>
                            </div>
                        </div>
                        <button onClick={navigateToReservations} className="btn-sm btn-primary text-xs whitespace-nowrap flex-shrink-0">예약하기</button>
                    </div>
                </div>
            )}

            {/* 예약없는 출발 — 운행 중에는 숨김 */}
            {!hasActiveDrive && (
                <div className="mt-3">
                    <button onClick={navigateToQuickDrive} className="w-full glass-card px-4 py-3 border-l-4 border-l-emerald-400 hover:shadow-lg transition-all group">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-sm flex-shrink-0 group-hover:scale-110 transition-transform">🚗</span>
                                <div className="min-w-0 text-left">
                                    <p className="font-medium text-surface-800 dark:text-surface-200 text-sm">예약 없는 운행</p>
                                    {recommendedVehicle ? (
                                        <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                                            {recommendedVehicle.displayName} ·{' '}
                                            {recommendedVehicle.minutesUntilNext === Infinity
                                                ? '오늘 남은 예약 없음'
                                                : `${Math.floor(recommendedVehicle.minutesUntilNext / 60)}시간 ${recommendedVehicle.minutesUntilNext % 60}분 여유`
                                            }
                                        </p>
                                    ) : (
                                        <p className="text-xs text-surface-500 dark:text-surface-400">바로 운행을 시작하세요</p>
                                    )}
                                </div>
                            </div>
                            <span className="btn-sm inline-flex items-center justify-center bg-emerald-500 dark:bg-emerald-600 text-white hover:bg-emerald-600 dark:hover:bg-emerald-500 text-xs whitespace-nowrap flex-shrink-0">바로 운행</span>
                        </div>
                    </button>
                </div>
            )}

            {/* 이번 주 예약 */}
            <WeekReservationList
                weekGrouped={weekGrouped}
                vehicles={vehicles}
                cancellingId={cancellingId}
                onCancelReservation={handleCancelWeekReservation}
            />
        </div>
    );
}
