import { memo } from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../../lib/constants';
import VehicleSelector from '../VehicleSelector';
import type { Vehicle } from '../../../types/vehicle';
import type { DriveLogForm } from '../../../hooks/driveLogForm/types';
import type { LocationState } from '../../../hooks/driveLogForm/types';

interface VehicleInfoSectionProps {
    reservationData: LocationState | null;
    isEditMode: boolean;
    form: DriveLogForm;
    selectedVehicle: Vehicle | undefined;
    vehicles: Vehicle[];
    usageCounts: Map<string, number>;
    handleVehicleSelect: (vehicleId: string) => void;
}

const VehicleInfoSection = memo(function VehicleInfoSection({
    reservationData,
    isEditMode,
    form,
    selectedVehicle,
    vehicles,
    usageCounts,
    handleVehicleSelect
}: VehicleInfoSectionProps) {
    if (reservationData?.vehicleId || isEditMode) {
        return (
            <div className="glass-card p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${getVehicleColor(form.vehicleId)}`}>
                            {(selectedVehicle?.vehicleType ? VEHICLE_TYPE_ICONS[selectedVehicle.vehicleType] : undefined) || '🚗'}
                        </span>
                        <div>
                            <p className="font-semibold text-surface-900 dark:text-surface-100">{form.vehicleName}</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">
                                {isEditMode ? '수정 중인 차량' : '예약 배정 차량'}
                            </p>
                        </div>
                    </div>
                    {form.startTime && (
                        <div className="text-right">
                            <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{form.startTime}</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">출발 시각</p>
                        </div>
                    )}
                </div>
                {reservationData && (form.purpose || form.destination) && (
                    <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 grid grid-cols-2 gap-4">
                        {form.purpose && (
                            <div>
                                <p className="text-xs text-surface-400 dark:text-surface-500">운행 목적</p>
                                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{form.purpose}</p>
                            </div>
                        )}
                        {form.destination && (
                            <div>
                                <p className="text-xs text-surface-400 dark:text-surface-500">행선지</p>
                                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{form.destination}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div>
            <label className="label">차량 선택 <span className="text-red-500 dark:text-red-400">*</span></label>
            <VehicleSelector
                vehicles={vehicles}
                selectedVehicleId={form.vehicleId}
                onSelect={handleVehicleSelect}
                usageCounts={usageCounts}
            />
        </div>
    );
});

export default VehicleInfoSection;
