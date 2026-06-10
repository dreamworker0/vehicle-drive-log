/**
 * QuickDriveStart — 예약없는 출발 시작 페이지
 * 차량 선택, 목적지, 목적 입력 후 운행 시작
 */
import { useState } from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import useQuickDriveStart from '../../hooks/useQuickDriveStart';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import VehicleSelector from './VehicleSelector';

export default function QuickDriveStart() {
    const {
        form, setForm,
        vehicles, favorites,
        loading, submitting,
        selectedVehicle,
        routeInfo, routeLoading,
        freeRoadRoute, freeRoadLoading, handleFetchFreeRoad,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleStart,
    } = useQuickDriveStart();
    const { usageCounts } = useVehiclePriority();
    const [showFreeRoad, setShowFreeRoad] = useState(false);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">
                운행 시작
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-6">
                차량과 운행 정보를 입력하세요
            </p>

            <div className="space-y-5">
                {/* 차량 선택 */}
                <div>
                    <label className="label">차량 선택 <span className="text-red-500 dark:text-red-400">*</span></label>
                    <VehicleSelector
                        vehicles={vehicles}
                        selectedVehicleId={form.vehicleId}
                        onSelect={handleVehicleSelect}
                        usageCounts={usageCounts}
                    />
                </div>

                {/* 선택된 차량 표시 */}
                {selectedVehicle && (
                    <div className="glass-card p-4 flex items-center gap-3">
                        <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${getVehicleColor(form.vehicleId)}`}>
                            {VEHICLE_TYPE_ICONS[selectedVehicle?.vehicleType ?? ''] || '🚗'}
                        </span>
                        <div>
                            <p className="font-semibold text-surface-900 dark:text-surface-100">{form.vehicleName}</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">선택된 차량</p>
                        </div>
                    </div>
                )}

                {/* 목적지 */}
                <div>
                    <label className="label">목적지 <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="text"
                        value={form.destination}
                        onChange={e => setForm({ ...form, destination: e.target.value })}
                        className="input min-h-[48px]"
                        placeholder="예: 강남역, 서울역 (여러 곳 운행은 쉼표로 구분)"
                    />
                    {/* 즐겨찾기 칩 */}
                    {favorites.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {favorites.map((fav) => (
                                <button
                                    key={fav.id}
                                    type="button"
                                    onClick={() => handleFavoriteSelect(fav)}
                                    className={`px-3 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all flex items-center justify-center ${form.destination === (fav.address || fav.name)
                                        ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                                        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                        }`}
                                >
                                    ⭐ {fav.name}
                                </button>
                            ))}
                        </div>
                    )}
                    {/* 경로 정보 */}
                    {(routeLoading || routeInfo) && (
                        <div className="mt-2">
                            {routeLoading ? (
                                <div className="flex items-center gap-2 text-xs text-surface-400 dark:text-surface-500 py-1">
                                    <div className="w-3 h-3 spinner" />
                                    경로 탐색 중...
                                </div>
                            ) : routeInfo && (
                                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/40 animate-fade-in space-y-1.5">
                                    <div className="flex items-center gap-3 text-xs">
                                        {routeInfo.hasToll && <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/40 px-1.5 py-0.5 rounded">고속</span>}
                                        <span className="font-bold text-blue-700 dark:text-blue-300">🗺️ {'isMulti' in routeInfo && routeInfo.isMulti ? '총 ' : ''}{Math.floor(routeInfo.distance)}km</span>
                                        <span className="font-bold text-blue-700 dark:text-blue-300">⏱ {'isMulti' in routeInfo && routeInfo.isMulti ? '총 ' : ''}{routeInfo.duration}분</span>
                                        {(routeInfo.tollFee ?? 0) > 0 && (
                                            <span className="text-blue-600 dark:text-blue-400">₩{(routeInfo.tollFee ?? 0).toLocaleString()}</span>
                                        )}
                                        {routeInfo.hasToll && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const next = !showFreeRoad;
                                                    setShowFreeRoad(next);
                                                    if (next && !freeRoadRoute && !freeRoadLoading) handleFetchFreeRoad();
                                                }}
                                                className="ml-auto flex-shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                                                title="무료도로 경로 보기"
                                            >
                                                {freeRoadLoading && showFreeRoad
                                                    ? <div className="w-3 h-3 spinner" />
                                                    : <svg aria-hidden="true" className={`w-3.5 h-3.5 text-blue-500 dark:text-blue-400 transition-transform duration-200 ${showFreeRoad ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                                }
                                            </button>
                                        )}
                                    </div>
                                    {showFreeRoad && freeRoadRoute && (
                                        <div className="flex items-center gap-3 text-xs border-t border-blue-200/50 dark:border-blue-800/30 pt-1.5 animate-fade-in">
                                            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-800/40 px-1.5 py-0.5 rounded">무료</span>
                                            <span className="font-bold text-emerald-700 dark:text-emerald-300">🗺️ {Math.floor(freeRoadRoute.distance)}km</span>
                                            <span className="font-bold text-emerald-700 dark:text-emerald-300">⏱ {freeRoadRoute.duration}분</span>
                                            {freeRoadRoute.tollFee > 0 && (
                                                <span className="text-emerald-600 dark:text-emerald-400">₩{freeRoadRoute.tollFee.toLocaleString()}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 목적 */}
                <div>
                    <label className="label">목적</label>
                    <input
                        type="text"
                        value={form.purpose}
                        onChange={e => setForm({ ...form, purpose: e.target.value })}
                        className="input min-h-[48px]"
                        placeholder="출장, 외근 등"
                    />
                </div>

                {/* 운행 시작 버튼 */}
                <button
                    onClick={handleStart}
                    disabled={submitting || !form.vehicleId || !form.destination.trim()}
                    className="w-full btn-primary py-3 text-base font-bold min-h-[48px]"
                >
                    {submitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-5 h-5 spinner" />
                            시작 중...
                        </span>
                    ) : (
                        <span className="flex items-center justify-center gap-2">
                            🚗 운행 시작
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}
