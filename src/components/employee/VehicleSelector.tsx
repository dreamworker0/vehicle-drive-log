/**
 * VehicleSelector — 차량 선택 카드 그리드
 * DriveLogForm에서 추출된 서브 컴포넌트
 * usageCounts가 전달되면 사용 빈도순으로 자동 정렬
 */
import { useMemo } from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { isVehicleBlocked, isVehicleRestrictedForUser } from '../../lib/vehicleUtils';
import { useAuth } from '../../hooks/useAuth';
import type { Vehicle } from '../../types/vehicle';

interface VehicleSelectorProps {
    vehicles: Vehicle[];
    selectedVehicleId: string;
    onSelect: (vehicleId: string) => void;
    /** 사용자별 차량 사용 횟수 (useVehiclePriority에서 제공) */
    usageCounts?: Map<string, number>;
}

export default function VehicleSelector({ vehicles, selectedVehicleId, onSelect, usageCounts }: VehicleSelectorProps) {
    const { user } = useAuth();
    // 폐차 차량은 목록에서 제외 + 사용 빈도순 정렬
    const activeVehicles = useMemo(() => {
        const filtered = vehicles.filter(v => !v.retired?.isRetired);
        if (!usageCounts || usageCounts.size === 0) return filtered;
        return [...filtered].sort((a, b) => (usageCounts.get(b.id) || 0) - (usageCounts.get(a.id) || 0));
    }, [vehicles, usageCounts]);

    if (activeVehicles.length === 0) {
        return <p className="text-sm text-surface-400 dark:text-surface-500">등록된 차량이 없습니다. 관리자에게 문의하세요.</p>;
    }

    return (
        <div className="grid grid-cols-3 gap-1.5">
            {activeVehicles.map(v => {
                const isBlocked = isVehicleBlocked(v.maintenance);
                const isRestricted = !isBlocked && isVehicleRestrictedForUser(v, user?.uid);
                const isDisabled = isBlocked || isRestricted;
                const count = usageCounts?.get(v.id) || 0;
                return (
                    <button
                        key={v.id}
                        type="button"
                        onClick={() => !isDisabled && onSelect(v.id)}
                        disabled={isDisabled}
                        className={`p-2 min-h-[48px] min-w-[48px] rounded-lg border text-left transition-all relative ${isDisabled
                            ? 'border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 opacity-50 cursor-not-allowed'
                            : selectedVehicleId === v.id
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 ring-2 ring-primary-500/30 dark:ring-primary-400/30'
                                : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 hover:border-surface-300 dark:hover:border-surface-500'
                            }`}
                    >
                        {/* 사용 횟수 배지 */}
                        {count > 0 && !isDisabled && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-50 dark:bg-primary-900/300 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                                {count}
                            </span>
                        )}
                        <div className="flex flex-col items-center gap-1">
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isDisabled ? 'bg-surface-200 dark:bg-surface-700' : getVehicleColor(v.id)}`}>
                                {isBlocked ? '🔧' : isRestricted ? '🔒' : (VEHICLE_TYPE_ICONS[v.vehicleType!] || '🚗')}
                            </span>
                            <p className={`font-medium text-xs text-center leading-tight ${isDisabled ? 'text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100'}`}>
                                {v.displayName}
                            </p>
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
    );
}
