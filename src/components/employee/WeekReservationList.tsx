/**
 * WeekReservationList — 이번 주 예약 목록
 */
import { forwardRef } from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

interface WeekReservationListProps {
    weekGrouped: Record<string, Reservation[]>;
    vehicles: Vehicle[];
    cancellingId: string | null;
    onCancelReservation: (res: Reservation) => void;
}

const WeekReservationList = forwardRef<HTMLDivElement, WeekReservationListProps>(function WeekReservationList({
    weekGrouped, vehicles, cancellingId, onCancelReservation,
}, ref) {
    if (Object.keys(weekGrouped).length === 0) return null;

    return (
        <div ref={ref} className="mt-6">
            <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-3">
                이번 주 예약
            </h2>
            <div className="flex flex-row overflow-x-auto snap-x snap-mandatory space-x-3 pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {Object.entries(weekGrouped).flatMap(([date, reservations]) => {
                    const d = new Date(date + 'T00:00:00');
                    const label = d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
                    return reservations.map((res) => {
                        const vehicle = vehicles.find(v => v.id === res.vehicleId);
                        return (
                            <div key={res.id} className="glass-card px-4 py-3 flex flex-col gap-2 shrink-0 w-[85%] snap-center transition-colors">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-primary-600 dark:text-primary-400">{label}</p>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${res.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300'}`}>
                                            {res.status === 'in_progress' ? '운행 중' : '예약됨'}
                                        </span>
                                        {res.groupId && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 rounded-full font-medium">
                                                🔗
                                            </span>
                                        )}
                                        {res.status === 'reserved' && (
                                            <button onClick={() => onCancelReservation(res)} disabled={cancellingId === res.id} className="text-xs text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1 min-w-[48px] min-h-[48px] flex items-center justify-center" title="예약 취소">
                                                {cancellingId === res.id ? (
                                                    <div className="w-3.5 h-3.5 spinner" />
                                                ) : (
                                                    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                    </svg>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-100 dark:bg-surface-800'}`}>
                                        {VEHICLE_TYPE_ICONS[vehicle?.vehicleType ?? ''] || '🚗'}
                                    </span>
                                    <div className="flex-1 min-w-0 text-left">
                                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{res.vehicleName || vehicle?.displayName || vehicle?.name || ''}</p>
                                        <p className="text-xs text-surface-400 dark:text-surface-500">
                                            {res.startTime} ~ {res.endTime}
                                            {res.destination && <span className="text-surface-500 dark:text-surface-400 font-medium ml-1">· {res.destination}</span>}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    });
                })}
            </div>
        </div>
    );
});

export default WeekReservationList;
