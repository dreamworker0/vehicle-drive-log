/**
 * VehicleSelector — 차량 선택 카드 그리드
 * DriveLogForm에서 추출된 서브 컴포넌트
 */
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';

export default function VehicleSelector({ vehicles, selectedVehicleId, onSelect }) {
    // 폐차 차량은 목록에서 제외
    const activeVehicles = vehicles.filter(v => !v.retired?.isRetired);

    if (activeVehicles.length === 0) {
        return <p className="text-sm text-surface-400">등록된 차량이 없습니다. 관리자에게 문의하세요.</p>;
    }

    return (
        <div className="grid grid-cols-3 gap-1.5">
            {activeVehicles.map(v => {
                const isBlocked = v.maintenance?.isBlocked;
                return (
                    <button
                        key={v.id}
                        type="button"
                        onClick={() => !isBlocked && onSelect(v.id)}
                        disabled={isBlocked}
                        className={`p-2 rounded-lg border text-left transition-all ${isBlocked
                            ? 'border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 opacity-50 cursor-not-allowed'
                            : selectedVehicleId === v.id
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 ring-2 ring-primary-500/30 dark:ring-primary-400/30'
                                : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 hover:border-surface-300 dark:hover:border-surface-500'
                            }`}
                    >
                        <div className="flex flex-col items-center gap-1">
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isBlocked ? 'bg-surface-200 dark:bg-surface-700' : getVehicleColor(v.id)}`}>
                                {isBlocked ? '🔧' : (VEHICLE_TYPE_ICONS[v.vehicleType] || '🚗')}
                            </span>
                            <p className={`font-medium text-xs text-center leading-tight ${isBlocked ? 'text-surface-400' : 'text-surface-900 dark:text-surface-100'}`}>
                                {v.displayName}
                            </p>
                            {isBlocked && (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">정비 중</span>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
