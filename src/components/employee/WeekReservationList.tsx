/**
 * WeekReservationList — 이번 주 예약 목록
 */
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

interface WeekReservationListProps {
    weekGrouped: Record<string, Reservation[]>;
    vehicles: Vehicle[];
    cancellingId: string | null;
    onCancelReservation: (res: Reservation) => void;
}

export default function WeekReservationList({
    weekGrouped, vehicles, cancellingId, onCancelReservation,
}: WeekReservationListProps) {
    if (Object.keys(weekGrouped).length === 0) return null;

    return (
        <div className="mt-6">
            <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-3">
                이번 주 예약
            </h2>
            <div className="space-y-3">
                {Object.entries(weekGrouped).map(([date, reservations]) => {
                    const d = new Date(date + 'T00:00:00');
                    const label = d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
                    return (
                        <div key={date}>
                            <p className="text-xs font-medium text-surface-400 mb-1.5 pl-1">{label}</p>
                            <div className="space-y-1.5">
                                {reservations.map(res => {
                                    const vehicle = vehicles.find(v => v.id === res.vehicleId);
                                    return (
                                        <div key={res.id} className="glass-card px-4 py-3 flex items-center gap-3">
                                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-100'}`}>
                                                {VEHICLE_TYPE_ICONS[vehicle?.vehicleType ?? ''] || '🚗'}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{(res as any).vehicleName}</p>
                                                <p className="text-xs text-surface-400">
                                                    {res.startTime} ~ {res.endTime}
                                                    {res.destination && ` · ${res.destination}`}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${res.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'}`}>
                                                    {res.status === 'in_progress' ? '운행 중' : '예약됨'}
                                                </span>
                                                {res.status === 'reserved' && (
                                                    <button onClick={() => onCancelReservation(res)} disabled={cancellingId === res.id} className="text-xs text-surface-400 hover:text-red-500 transition-colors p-1" title="예약 취소">
                                                        {cancellingId === res.id ? (
                                                            <div className="w-3.5 h-3.5 spinner" />
                                                        ) : (
                                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
