/**
 * TodayDashboard — 오늘의 운행 페이지
 * 로직은 useTodayDashboard 훅 사용
 * 서브 컴포넌트: WelcomeGuide, ReservationCard, WeekReservationList
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import useTodayDashboard from '../../hooks/useTodayDashboard';
import ReleaseNotesBanner from '../common/ReleaseNotesBanner';
import { useCalendarSync } from '../../hooks/useCalendarSync';
import { updateUser } from '../../lib/firestore';
import { SkeletonCard, SkeletonBox } from '../common/Skeleton';
import WelcomeGuide from './WelcomeGuide';
import ReservationCard from './ReservationCard';
import WeekReservationList from './WeekReservationList';
import ReservationPatternBanner from './ReservationPatternBanner';
import ConfirmModal from '../common/ConfirmModal';
import type { Reservation } from '../../types/reservation';
import type { Vehicle } from '../../types/vehicle';

export default function TodayDashboard() {
    const { user, userData } = useAuth();
    const {
        vehicles, startingId, cancellingId,
        myReservations, weekGrouped, todayLabel,
        incompleteAlerts, hasActiveDrive,
        handleStartDrive, handleStartNavigation,
        handleCancelWeekReservation, handleCancelTodayReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
        myLogsCount, refresh,
    } = useTodayDashboard();
    const { syncVehicleOnDemand, checkCooldown } = useCalendarSync();
    const navigate = useNavigate();
    const [cancelTarget, setCancelTarget] = useState<{ reservation: Reservation; type: 'today' | 'week' } | null>(null);
    // "이번 주 예약" 요소 ref — 추천 배너와의 화면 겹침 감지에 사용
    const weekRef = useRef<HTMLDivElement>(null);

    // 웰컴 가이드 (첫 방문 시 1회 표시)
    // 웰컴 가이드 표시 여부
    const [showWelcome, setShowWelcome] = useState(() => {
        if (userData?.welcomeDismissed) return false;
        try { return localStorage.getItem('employee-welcome-dismissed') !== 'true'; } catch { return true; }
    });

    const dismissWelcome = useCallback(() => {
        setShowWelcome(false);
        try { localStorage.setItem('employee-welcome-dismissed', 'true'); } catch { /* noop */ }
        if (user?.uid && !userData?.welcomeDismissed) {
            updateUser(user.uid, { welcomeDismissed: true }).catch(console.error);
        }
    }, [user, userData]);

    // 주행 기록을 3회 이상 남긴 사용자는 시스템에 익숙한 것으로 간주하여 가이드를 자동 종료 및 마킹
    useEffect(() => {
        if (showWelcome && myLogsCount >= 3) {
            setTimeout(dismissWelcome, 0);
        }
    }, [showWelcome, myLogsCount, dismissWelcome]);

    // 구글 캘린더 온디맨드 백그라운드 동기화 — 홈 진입 시에도 캘린더 직접 등록분을 반영
    // (기존에는 예약 캘린더 화면에서만 트리거되어 주말·홈 전용 사용자에게 사각지대가 있었음)
    // 30분 쿨다운(checkCooldown)으로 홈의 높은 접근 빈도에 따른 호출 비용을 방어한다.
    useEffect(() => {
        if (!userData?.organizationId || vehicles.length === 0) return;

        const triggerSyncs = async () => {
            let anySynced = false;
            for (const vehicle of vehicles as Vehicle[]) {
                const calId = vehicle.googleCalendarId;
                if (calId && calId.includes('@') && checkCooldown(vehicle.id)) {
                    const success = await syncVehicleOnDemand(vehicle.id, userData.organizationId!);
                    if (success) anySynced = true;
                }
            }
            // 새로 당겨온 예약이 있을 수 있으므로 대시보드 데이터 갱신
            if (anySynced) refresh();
        };

        triggerSyncs();
    }, [vehicles, userData?.organizationId, syncVehicleOnDemand, checkCooldown, refresh]);

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <ReleaseNotesBanner />
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">오늘의 운행</h1>
                    <p className="text-sm text-surface-400 dark:text-surface-500">{todayLabel}</p>
                </div>
                {!hasActiveDrive && (
                    <button
                        onClick={navigateToQuickDrive}
                        className="flex items-center gap-1 px-4 py-2 min-h-[48px] rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-colors text-xs font-medium"
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
                                className="z-10 bg-white text-red-600 hover:bg-red-50 px-4 py-2 min-h-[48px] rounded-xl text-sm font-bold shadow-sm transition-transform active:scale-95 whitespace-nowrap"
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
                        <span className="w-2 h-2 rounded-full bg-primary-50 dark:bg-primary-900/300" />
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
                            className="reservation-cta-btn flex-shrink-0 min-h-[48px]"
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
                ref={weekRef}
                weekGrouped={weekGrouped}
                vehicles={vehicles}
                cancellingId={cancellingId}
                onCancelReservation={(res) => setCancelTarget({ reservation: res, type: 'week' })}
            />

            {/* 예약 추천 (화면 맨 아래로 배치) — 이번 주 예약과 겹치면 자동 숨김 */}
            {!hasActiveDrive && (
                <ReservationPatternBanner anchorRef={weekRef} />
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
