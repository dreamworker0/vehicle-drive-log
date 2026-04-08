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
import ReservationPatternBanner from './ReservationPatternBanner';
import ConfirmModal from '../common/ConfirmModal';
import type { Reservation } from '../../types/reservation';
import type { Vehicle } from '../../types/vehicle';

export default function TodayDashboard() {
    const {
        vehicles, loading, startingId, cancellingId,
        myReservations, weekGrouped, todayLabel,
        incompleteAlerts, hasActiveDrive,
        handleStartDrive, handleStartNavigation,
        handleCancelWeekReservation, handleCancelTodayReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
    } = useTodayDashboard();
    const navigate = useNavigate();
    const [cancelTarget, setCancelTarget] = useState<{ reservation: Reservation; type: 'today' | 'week' } | null>(null);

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
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">오늘의 운행</h1>
                    <p className="text-sm text-surface-400">{todayLabel}</p>
                </div>
                {!hasActiveDrive && (
                    <button
                        onClick={navigateToQuickDrive}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-all border border-emerald-200 dark:border-emerald-800/50 shadow-sm hover:shadow active:scale-95"
                        title="예약 없이 바로 운행 시작"
                    >
                        <span>🚀 바로 운행</span>
                    </button>
                )}
            </div>

            {/* 첫 방문 웰컴 가이드 */}
            {showWelcome && <WelcomeGuide onDismiss={dismissWelcome} />}

            {/* 미작성 알림 */}
            {incompleteAlerts.length > 0 && (
                <div className="mb-4 space-y-2">
                    {incompleteAlerts.map((alert: Reservation & { type: string }, idx: number) => (
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
                                    const vehicle = vehicles.find((v: Vehicle) => v.id === alert.vehicleId);
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
                        {myReservations.map((res: Reservation) => {
                            const vehicle = vehicles.find((v: Vehicle) => v.id === res.vehicleId);
                            return (
                                <ReservationCard
                                    key={res.id}
                                    reservation={res}
                                    vehicle={vehicle}
                                    isInProgress={res.status === 'in_progress'}
                                    disabled={hasActiveDrive && res.status !== 'in_progress'}
                                    startingId={startingId}
                                    cancellingId={cancellingId}
                                    onStartDrive={handleStartDrive}
                                    onStartNavigation={handleStartNavigation}
                                    onArrival={navigateToArrival}
                                    onCancel={(res) => setCancelTarget({ reservation: res, type: 'today' })}
                                />
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 예약이 없을 때 안내 */}
            {myReservations.length === 0 && (
                <div className="glass-card px-5 py-5 border-l-4 border-l-primary-400">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                            <span className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-lg flex-shrink-0">📋</span>
                            <div className="min-w-0">
                                <p className="font-semibold text-surface-800 dark:text-surface-200 text-base">오늘 예약 없음</p>
                                <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">새 예약을 등록해보세요</p>
                            </div>
                        </div>
                        <button
                            onClick={navigateToReservations}
                            className="reservation-cta-btn flex-shrink-0"
                        >
                            <span className="reservation-cta-glow" />
                            <span className="relative z-10 flex items-center gap-1.5">
                                <span>📅</span>
                                <span>예약</span>
                            </span>
                        </button>
                    </div>
                </div>
            )}



            {/* 이번 주 예약 */}
            <WeekReservationList
                weekGrouped={weekGrouped}
                vehicles={vehicles}
                cancellingId={cancellingId}
                onCancelReservation={(res) => setCancelTarget({ reservation: res, type: 'week' })}
            />

            {/* 예약 추천 (화면 맨 아래로 배치) */}
            {!hasActiveDrive && (
                <ReservationPatternBanner />
            )}

            {/* 예약 취소 확인 모달 */}
            <ConfirmModal
                open={!!cancelTarget}
                title="예약 취소"
                message={cancelTarget ? `${cancelTarget.reservation.vehicleName} 예약을 취소하시겠습니까?` : ''}
                confirmText="취소하기"
                confirmColor="danger"
                onCancel={() => setCancelTarget(null)}
                onConfirm={() => {
                    if (!cancelTarget) return;
                    if (cancelTarget.type === 'today') {
                        handleCancelTodayReservation(cancelTarget.reservation);
                    } else {
                        handleCancelWeekReservation(cancelTarget.reservation);
                    }
                    setCancelTarget(null);
                }}
            />
        </div>
    );
}
