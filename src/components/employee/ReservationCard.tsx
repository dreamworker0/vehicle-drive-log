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
    onStartDrive: (reservation: Reservation) => void;
    onStartNavigation?: (reservation: Reservation, appId: string) => void;
    onArrival: (reservation: Reservation) => void;
    /** 하위 호환 */
    onStartWithTmap?: (reservation: Reservation) => void;
}

export default function ReservationCard({
    reservation, vehicle, isInProgress, disabled,
    startingId, onStartDrive, onStartNavigation, onArrival,
    onStartWithTmap,
}: ReservationCardProps) {
    const isButtonDisabled = disabled || startingId === reservation.id;

    // 설정된 기본 앱 읽기
    const preferredApp = (() => {
        try { return localStorage.getItem('preferred-nav-app') || 'naver'; } catch { return 'naver'; }
    })();

    const handleNavSelect = (appId: string) => {
        if (onStartNavigation) {
            onStartNavigation(reservation, appId);
        } else if (onStartWithTmap) {
            onStartWithTmap(reservation);
        }
    };

    return (
        <div className={isInProgress ? 'driving-card' : 'glass-card px-4 py-3 border-l-4 border-l-primary-400'}>
            {isInProgress && <div className="driving-progress-bar" />}
            <div className={isInProgress ? 'p-4' : ''}>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`${isInProgress ? 'w-12 h-12 text-xl' : 'w-8 h-8 text-sm'} rounded-lg flex items-center justify-center flex-shrink-0 ${vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-100'} transition-all`}>
                            <span style={isInProgress ? { display: 'inline-block', animation: 'carDrive 0.8s ease-in-out infinite' } : {}}>
                                {VEHICLE_TYPE_ICONS[vehicle?.vehicleType ?? ''] || '🚗'}
                            </span>
                        </span>
                        <div className="min-w-0">
                            <p className={`${isInProgress ? 'font-bold text-amber-900 dark:text-amber-200 text-base' : 'font-medium text-surface-800 dark:text-surface-200 text-sm'}`}>{(reservation as any).vehicleName}</p>
                            <p className={`text-xs ${isInProgress ? 'text-amber-700/70 dark:text-amber-300/80' : 'text-surface-500 dark:text-surface-300'}`}>
                                {reservation.startTime} ~ {reservation.endTime}
                                {reservation.destination && ` · ${reservation.destination}`}
                            </p>
                            {(reservation as any).routeDistance && (
                                <p className="text-xs text-blue-500 flex items-center gap-2 mt-0.5">
                                    <span>📍{Math.floor((reservation as any).routeDistance)}km</span>
                                    <span>⏱{(reservation as any).routeDuration}분</span>
                                    {(reservation as any).routeTollFee > 0 && <span>₩{(reservation as any).routeTollFee.toLocaleString()}</span>}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {isInProgress ? (
                            <>
                                <span className="driving-badge">
                                    <span className="driving-dot" />
                                    운행 중
                                </span>
                                <button onClick={() => onArrival(reservation)} className="btn-sm bg-amber-600 text-white hover:bg-amber-700 text-xs whitespace-nowrap font-bold shadow-md hover:shadow-lg transition-all">
                                    🏁 도착
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
                                            className="btn-sm !min-h-0 py-1.5 bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-500 text-xs whitespace-nowrap shadow-sm"
                                            title={`${NAV_LABELS[preferredApp]} 길안내`}
                                        >
                                            🗺️ {NAV_LABELS[preferredApp]}
                                        </button>
                                        <button onClick={() => onStartDrive(reservation)} disabled={isButtonDisabled} className="btn-sm !min-h-0 py-1.5 btn-primary dark:bg-primary-500 dark:hover:bg-primary-400 text-xs whitespace-nowrap">
                                            {startingId === reservation.id ? <div className="w-4 h-4 spinner" /> : '운행 시작'}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
