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
        vehicles, startingId, cancellingId,
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
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-colors text-xs font-medium"
                    >
                        <span className="text-sm">🚀</span>
                        <span>바로 운행</span>
                    </button>
                )}
            </div>

            {/* 첫 방문 웰컴 가이드 */}
            {showWelcome && <WelcomeGuide onDismiss={dismissWelcome} />}

            {/* 미작성 알림 */}
            {incompleteAlerts.length > 0 && (
                <div className="mb-6 space-y-3">
                    {incompleteAlerts.map((alert: Reservation & { type: string }, idx: number) => (
                        <div key={alert.id || idx} className="relative overflow-hidden bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl p-4 shadow-md flex items-center gap-4 animate-fade-in group">
                            {/* 배경 효과 */}
                            <div className="absolute -right-4 -top-4 w-24 h-24 bg-white opacity-10 rounded-full blur-xl mix-blend-overlay group-hover:scale-150 transition-transform duration-700"></div>
                            
                            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-2xl flex-shrink-0 z-10 backdrop-blur-sm">
                                📝
                            </div>
                            <div className="flex-1 min-w-0 z-10">
                                <p className="text-base font-bold text-white tracking-tight">작성 대기중인 운행일지!</p>
                                <p className="text-sm text-red-100 truncate mt-0.5 opacity-90">
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
                                className="z-10 bg-white text-red-600 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-transform active:scale-95 whitespace-nowrap"
                            >
                                바로 작성
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* (바로 운행 버튼은 상단 타이틀 영역으로 이동됨) */}

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
                <div className="glass-card p-4 space-y-4 border border-primary-100 dark:border-primary-900/30">
                    <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-lg">💡</span>
                        <div>
                            <p className="font-bold text-surface-900 dark:text-surface-100">현재 예정된 운행이 없습니다</p>
                            <p className="text-xs text-surface-500 mt-0.5">어떤 작업이 필요하신가요?</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={navigateToQuickDrive}
                            className="flex-1 btn-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all"
                        >
                            <span className="text-lg">🚀</span>
                            <div className="text-left">
                                <div className="text-sm font-bold leading-none">바로 운행</div>
                                <div className="text-[10px] text-primary-100 font-normal leading-tight mt-0.5">예약없이 지금 타기</div>
                            </div>
                        </button>
                        <button
                            onClick={navigateToReservations}
                            className="flex-[0.8] bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-200 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                        >
                            <span className="text-lg text-surface-500">📅</span>
                            <div className="text-left">
                                <div className="text-sm font-bold leading-none">일정 예약</div>
                                <div className="text-[10px] text-surface-500 dark:text-surface-400 font-normal leading-tight mt-0.5">나중 날짜에 타기</div>
                            </div>
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
