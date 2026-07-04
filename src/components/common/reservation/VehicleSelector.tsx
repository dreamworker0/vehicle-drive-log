/**
 * VehicleSelector - 차량 그리드 선택기
 */
import React from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../../lib/constants';
import { isVehicleBlocked, isVehicleRestrictedForUser } from '../../../lib/vehicleUtils';
import { useAuth } from '../../../hooks/useAuth';
import type { Vehicle } from '../../../types/vehicle';
import type { ReservationForm } from '../../../types/reservation';

interface VehicleSelectorProps {
    vehicles: Vehicle[];
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    usageCounts?: Map<string, number>;
    destinationRef: React.RefObject<HTMLInputElement | null>;
}

export default function VehicleSelector({
    vehicles,
    form,
    setForm,
    usageCounts,
    destinationRef,
}: VehicleSelectorProps) {
    const { user } = useAuth();
    return (
        <div>
            <label className="label text-sm font-medium">🚘 차량 <span className="text-red-500 dark:text-red-400">*</span></label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
                {vehicles.map(v => {
                    const isBlocked = isVehicleBlocked(v.maintenance);
                    const isRestricted = !isBlocked && isVehicleRestrictedForUser(v, user?.uid);
                    const isDisabled = isBlocked || isRestricted;
                    const count = usageCounts?.get(v.id) || 0;
                    return (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => { if (!isDisabled) { setForm({ ...form, vehicleId: v.id }); setTimeout(() => destinationRef.current?.focus(), 50); } }}
                            disabled={isDisabled}
                            className={`p-2.5 rounded-xl border text-left transition-all relative ${isDisabled
                                ? 'border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 opacity-50 cursor-not-allowed'
                                : form.vehicleId === v.id
                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/40 ring-1 ring-primary-500/50 shadow-md transform -translate-y-0.5'
                                    : 'border-surface-200 dark:border-surface-600 hover:border-surface-300 hover:bg-surface-50 bg-white dark:bg-surface-800 shadow-sm'
                                }`}
                        >
                            {count > 0 && !isDisabled && (
                                <span title={`최근 사용: ${count}회`} className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-primary-500 dark:bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                                    {count}
                                </span>
                            )}
                            <div className="flex flex-col items-center gap-1">
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isDisabled ? 'bg-surface-200 dark:bg-surface-700' : getVehicleColor(v.id)}`}>
                                    {isBlocked ? '🔧' : isRestricted ? '🔒' : (VEHICLE_TYPE_ICONS[v.vehicleType as keyof typeof VEHICLE_TYPE_ICONS] || '🚗')}
                                </span>
                                <p className={`font-medium text-xs text-center leading-tight ${isDisabled ? 'text-surface-400' : 'text-surface-900 dark:text-surface-100'}`}>{v.displayName}</p>
                                {isBlocked && (
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">정비 중</span>
                                )}
                                {isRestricted && (
                                    <span className="text-[10px] text-surface-500 dark:text-surface-400 font-medium">지정 차량</span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
