/**
 * ReservationCard — 오늘의 예약 카드 (운행 시작/도착 버튼 포함)
 */
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

const NAV_LABELS: Record<string, string> = { naver: '네이버', kakao: '카카오', tmap: '티맵' };

interface ReservationCardProps {
    reservation: Reservation;
    vehicle: Vehicle | undefined;
    isInProgress: boolean;
    disabled: boolean;
    startingId: string | null;
    cancellingId?: string | null;
    onStartDrive: (reservation: Reservation) => void;
    onStartNavigation?: (reservation: Reservation, appId: string) => void;
    onArrival: (reservation: Reservation) => void;
    onCancel?: (reservation: Reservation) => void;
    /** 하위 호환 */
    onStartWithTmap?: (reservation: Reservation) => void;
}

export default function ReservationCard({
    reservation, vehicle, isInProgress, disabled,
    startingId, cancellingId, onStartDrive, onStartNavigation, onArrival, onCancel,
    onStartWithTmap,
}: ReservationCardProps) {
    const isButtonDisabled = disabled || startingId === reservation.id;

    // 운행 시작 임박 여부 계산 (오늘 30분 전 ~ 15분 경과)
    const isSoon = (() => {
        if (isInProgress || reservation.status === 'pending') return false;
        try {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            // reservation.date가 없을 수 있으나 대부분 존재
            if (reservation.date && reservation.date !== todayStr) return false;

            const [hours, minutes] = reservation.startTime.split(':').map(Number);
            const resTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
            const diffMin = (resTime.getTime() - now.getTime()) / (1000 * 60);

            return diffMin >= -15 && diffMin <= 30;
        } catch {
            return false;
        }
    })();

    // 설정된 기본 앱 읽기
    const preferredApp = (() => {
        try { return localStorage.getItem('preferred-nav-app') || 'naver'; } catch { return 'naver'; }
    })();

    const handleNavSelect = (appId: string) => {
        const hasWaypoints = reservation.destination && reservation.destination.includes(',');
        if (hasWaypoints && appId !== 'naver') {
            if (!window.confirm('카카오맵/티맵은 다중 경유지를 완벽히 지원하지 않아 최종 목적지로만 안내될 수 있습니다.\n\n경유지가 포함된 경로는 설정에서 "네이버 지도"를 기본 길안내 앱으로 변경하시길 권장합니다.\n\n그래도 현재 선택된 앱으로 길안내를 계속하시겠습니까?')) {
                return;
            }
        }

        if (onStartNavigation) {
            onStartNavigation(reservation, appId);
        } else if (onStartWithTmap) {
            onStartWithTmap(reservation);
        }
    };

    return (
        <div className={
            isInProgress ? 'driving-card' : 
            isSoon ? 'glass-card px-4 py-3 border-l-4 border-l-amber-500 shadow-md ring-1 ring-amber-500/50 bg-amber-50/10 dark:bg-amber-900/10' : 
            'glass-card px-4 py-3 border-l-4 border-l-primary-400'
        }>
            {isInProgress && <div className="driving-progress-bar" />}
            <div className={isInProgress ? 'p-4' : ''}>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`${isInProgress ? 'w-12 h-12 text-xl' : isSoon ? 'w-10 h-10 text-base shadow-sm ring-1 ring-amber-200 dark:ring-amber-700/50' : 'w-8 h-8 text-sm'} rounded-lg flex items-center justify-center flex-shrink-0 ${vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-100 dark:bg-surface-800'} transition-all`}>
                            <span style={isInProgress ? { display: 'inline-block', animation: 'carDrive 0.8s ease-in-out infinite' } : {}}>
                                {VEHICLE_TYPE_ICONS[vehicle?.vehicleType ?? ''] || '🚗'}
                            </span>
                        </span>
                        <div className="min-w-0">
                            {isSoon && (
                                <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 animate-pulse tracking-wide mb-0.5">🚀 운행 시작 임박</p>
                            )}
                            <p className={`${isInProgress ? 'font-bold text-amber-900 dark:text-amber-200 text-base' : isSoon ? 'font-bold text-surface-900 dark:text-surface-100 text-sm' : 'font-medium text-surface-800 dark:text-surface-200 text-sm'}`}>{reservation.vehicleName || vehicle?.displayName || vehicle?.name || ''}</p>
                            <p className={`text-xs ${isInProgress ? 'text-amber-700/70 dark:text-amber-300/80' : 'text-surface-500 dark:text-surface-300'}`}>
                                {reservation.startTime} ~ {reservation.endTime}
                                {reservation.destination && ` · ${reservation.destination}`}
                            </p>
                            {reservation.recurringGroupId && (
                                <span className="inline-flex items-center gap-0.5 mt-0.5 text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300 rounded-full font-medium w-fit">
                                    반복 예약
                                </span>
                            )}
                            {reservation.groupId && !reservation.recurringGroupId && (
                                <span className="inline-flex items-center gap-0.5 mt-0.5 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 rounded-full font-medium w-fit">
                                    🔗 다일 예약
                                </span>
                            )}
                            {reservation.routeDistance && (
                                <p className="text-xs text-blue-500 dark:text-blue-400 flex items-center gap-2 mt-0.5">
                                    <span>↔{Math.floor(reservation.routeDistance)}km</span>
                                    <span>⏱{reservation.routeDuration}분</span>
                                    {(reservation.routeTollFee ?? 0) > 0 && <span>₩{reservation.routeTollFee!.toLocaleString()}</span>}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex flex-col gap-2 w-full sm:w-auto min-w-[110px]">
                            {reservation.status === 'pending' ? (
                                <div className="py-2.5 px-3 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-bold text-center border border-amber-200 dark:border-amber-800/50 shadow-sm flex items-center justify-center gap-1.5 w-full text-sm">
                                    <svg aria-hidden="true" className="w-4 h-4 animate-pulse" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2.25m0 2.25h.01M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Z" />
                                    </svg>
                                    승인 대기 중
                                </div>
                            ) : isInProgress ? (
                                <>
                                    <span className="driving-badge w-full justify-center">
                                        <span className="driving-dot" />
                                        운행 중
                                    </span>
                                    <button onClick={() => onArrival(reservation)} className="w-full bg-amber-600 dark:bg-amber-500 text-white hover:bg-amber-700 dark:hover:bg-amber-400 shadow-md hover:shadow-lg transition-all rounded-xl py-2 px-2 flex flex-col items-center justify-center min-w-[120px] min-h-[48px]">
                                        <span className="text-sm font-bold whitespace-nowrap">🏁 운행 종료</span>
                                        <span className="text-[10px] text-amber-100 font-normal mt-0.5 whitespace-nowrap tracking-tight">종료 후 일지작성</span>
                                    </button>
                                </>
                            ) : (
                                <>
                                    {disabled ? (
                                        <span className="text-[11px] text-surface-400 dark:text-surface-500 whitespace-nowrap">다른 운행 진행 중</span>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleNavSelect(preferredApp)}
                                                disabled={isButtonDisabled}
                                                className={`w-full rounded-xl py-2.5 px-4 min-h-[48px] font-semibold text-sm ${isSoon ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-600 dark:hover:bg-blue-500'} whitespace-nowrap shadow-sm transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed`}
                                                title={`${NAV_LABELS[preferredApp]} 길안내`}
                                            >
                                                <span>🗺️</span>
                                                {NAV_LABELS[preferredApp]}
                                            </button>
                                            <button 
                                                onClick={() => onStartDrive(reservation)} 
                                                disabled={isButtonDisabled} 
                                                className={`w-full rounded-xl py-2.5 px-4 min-h-[48px] font-bold text-sm ${isSoon ? 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500 text-white shadow-md' : 'btn-primary dark:bg-primary-500 dark:hover:bg-primary-400'} whitespace-nowrap transition-colors inline-flex items-center justify-center flex-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                                            >
                                                {startingId === reservation.id ? <div className="w-4 h-4 spinner" /> : '운행 시작'}
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        {onCancel && (
                            <button
                                onClick={() => onCancel(reservation)}
                                disabled={cancellingId === reservation.id}
                                className="text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1 min-w-[48px] min-h-[48px] flex items-center justify-center"
                                title="예약 취소"
                            >
                                {cancellingId === reservation.id ? (
                                    <div className="w-3.5 h-3.5 spinner" />
                                ) : (
                                    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
