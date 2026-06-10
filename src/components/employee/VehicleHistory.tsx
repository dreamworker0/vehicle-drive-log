/**
 * VehicleHistory — 차량 이용 내역 조회
 * 로직은 useVehicleHistory 훅으로 분리, UI만 담당
 */
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { formatTimestamp, formatTimestampTime } from '../../lib/dateUtils';
import useVehicleHistory from '../../hooks/useVehicleHistory';

export default function VehicleHistory() {
    const {
        vehicles, selectedVehicleId, selectedVehicle, logs,
        loading, logsLoading, totalDistance,
        period, setPeriod, dropdownOpen, setDropdownOpen, dropdownRef,
        handleSelectVehicle,
        PERIOD_OPTIONS,
    } = useVehicleHistory();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">차량 이용 내역</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">차량별 운행 기록을 조회합니다</p>

            {/* 차량 선택 */}
            {vehicles.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🚗</div>
                    <p className="text-surface-400 dark:text-surface-500 font-medium">등록된 차량이 없습니다</p>
                </div>
            ) : (
                <>
                    {/* 커스텀 드롭다운 차량 선택 */}
                    <div className="relative mb-3" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={() => setDropdownOpen((prev: boolean) => !prev)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[48px] rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 transition-all hover:border-surface-300 dark:hover:border-surface-500"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                {selectedVehicle && (
                                    <>
                                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${getVehicleColor(selectedVehicle.id)}`}>
                                            {VEHICLE_TYPE_ICONS[selectedVehicle.vehicleType ?? ''] || '🚗'}
                                        </span>
                                        <div className="min-w-0 text-left">
                                            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{selectedVehicle.displayName}</p>
                                            <p className="text-xs text-surface-400 dark:text-surface-500 truncate">{selectedVehicle.plateNumber}</p>
                                        </div>
                                    </>
                                )}
                            </div>
                            {/* 화살표 아이콘 */}
                            <svg aria-hidden="true" className={`w-4 h-4 text-surface-400 dark:text-surface-500 flex-shrink-0 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {/* 드롭다운 패널 */}
                        {dropdownOpen && (
                            <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 shadow-lg overflow-hidden animate-fade-in">
                                <div className="max-h-60 overflow-y-auto py-1">
                                    {vehicles.map((v) => (
                                        <button
                                            key={v.id}
                                            type="button"
                                            onClick={() => handleSelectVehicle(v.id)}
                                            className={`w-full flex items-center gap-3 px-4 py-2.5 min-h-[48px] text-left transition-colors ${selectedVehicleId === v.id
                                                ? 'bg-primary-50 dark:bg-primary-900/20'
                                                : 'hover:bg-surface-50 dark:hover:bg-surface-700'
                                                }`}
                                        >
                                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${getVehicleColor(v.id)}`}>
                                                {VEHICLE_TYPE_ICONS[v.vehicleType ?? ''] || '🚗'}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{v.displayName}</p>
                                                <p className="text-xs text-surface-400 dark:text-surface-500 truncate">{v.plateNumber}</p>
                                            </div>
                                            {selectedVehicleId === v.id && (
                                                <svg aria-hidden="true" className="w-4 h-4 text-primary-500 dark:text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 기간 선택 */}
                    <div className="flex gap-1.5 mb-4">
                        {PERIOD_OPTIONS.map((opt) => (
                            <button
                                key={opt.days}
                                onClick={() => setPeriod(opt.days)}
                                className={`px-3 py-1.5 min-h-[48px] min-w-[48px] rounded-full text-xs font-medium border transition-all ${period === opt.days
                                    ? 'bg-surface-800 text-white border-surface-800 dark:bg-surface-600 dark:border-surface-600'
                                    : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-600 hover:border-surface-400 dark:hover:border-surface-500'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* 요약 */}
                    {selectedVehicle && (
                        <div className="glass-card p-4 mb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${getVehicleColor(selectedVehicle.id)}`}>
                                        {VEHICLE_TYPE_ICONS[selectedVehicle.vehicleType ?? ''] || '🚗'}
                                    </span>
                                    <div>
                                        <p className="font-semibold text-surface-900 dark:text-surface-100">{selectedVehicle.displayName}</p>
                                        <p className="text-xs text-surface-400 dark:text-surface-500">{selectedVehicle.plateNumber}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{totalDistance.toLocaleString()} km</p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">{logs.length}건 운행</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 내역 목록 */}
                    {logsLoading ? (
                        <div className="flex items-center justify-center py-10">
                            <div className="w-6 h-6 spinner" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="glass-card p-10 text-center">
                            <p className="text-surface-400 dark:text-surface-500 text-sm">해당 기간에 운행 기록이 없습니다</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {logs.map((log) => (
                                <div key={log.id} className="glass-card p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{formatTimestamp(log.timestamp)}</span>
                                            <span className="text-xs text-surface-300 dark:text-surface-600">{formatTimestampTime(log.timestamp)}</span>
                                        </div>
                                        <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                                            {((log.endKm - log.startKm) || 0).toLocaleString()} km
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="w-6 h-6 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-xs">
                                            👤
                                        </span>
                                        <span className="text-surface-700 dark:text-surface-300 font-medium">{log.driverName}</span>
                                        {log.destination && (
                                            <>
                                                <span className="text-surface-300 dark:text-surface-600">→</span>
                                                <span className="text-surface-600 dark:text-surface-400 truncate">{log.destination}</span>
                                            </>
                                        )}
                                    </div>
                                    {log.purpose && (
                                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1 ml-8">{log.purpose}</p>
                                    )}
                                    <div className="text-xs text-surface-400 dark:text-surface-500 mt-1.5 ml-8 font-mono">
                                        {log.startKm?.toLocaleString()} → {log.endKm?.toLocaleString()} km
                                        {log.startTime && log.endTime && (
                                            <span className="ml-2">({log.startTime} ~ {log.endTime})</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
