/**
 * QuickDriveStart — 예약없는 출발 시작 페이지
 * 차량 선택, 목적지, 목적, 동승자 입력 후 운행 시작
 *
 * 입력 컴포넌트는 **예약 폼과 같은 것**을 쓴다(VehicleSelector · DestinationInput ·
 * RouteInfoPanel · 동승자). 두 화면이 갈라지면 같은 일을 하는 자리가 서로 다르게 보이고,
 * 목적지 여러 곳 입력처럼 한쪽에만 있는 기능이 생긴다.
 */
import { useMemo, useRef } from 'react';
import useQuickDriveStart from '../../hooks/useQuickDriveStart';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import { useReservationPattern } from '../../hooks/useReservationPattern';
import VehicleSelector from '../common/reservation/VehicleSelector';
import DestinationInput from '../common/reservation/DestinationInput';
import RouteInfoPanel from '../common/reservation/RouteInfoPanel';
import ReservationPassengerField from '../common/reservation/ReservationPassengerField';

export default function QuickDriveStart() {
    const {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting,
        routeInfo, routeLoading, departureSiteName,
        freeRoadRoute, freeRoadLoading, handleFetchFreeRoad,
        handleVehicleSelect,
        handleDestinationChange,
        handlePassengerChange,
        handleStart,
        showFavSave, setShowFavSave, favName, setFavName, handleSaveFavorite,
        passengerOptions,
    } = useQuickDriveStart();
    const { usageCounts } = useVehiclePriority();
    const { recentDestinations } = useReservationPattern();
    const destinationRef = useRef<HTMLInputElement>(null);

    // 폐차 제외 + 사용 빈도순 정렬 (예약 폼과 같은 기준)
    const sortedActiveVehicles = useMemo(() => {
        const filtered = vehicles.filter(v => !v.retired?.isRetired);
        if (!usageCounts || usageCounts.size === 0) return filtered;
        return [...filtered].sort((a, b) => (usageCounts.get(b.id) || 0) - (usageCounts.get(a.id) || 0));
    }, [vehicles, usageCounts]);

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
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">
                차량과 운행 정보를 입력하세요
            </p>

            <div className="mb-4 p-3 rounded-xl bg-primary-50/50 border border-primary-100 dark:bg-surface-700/50 dark:border-surface-600">
                <div className="space-y-4">
                    {/* 차량 선택 */}
                    <VehicleSelector
                        vehicles={sortedActiveVehicles}
                        selectedVehicleId={form.vehicleId}
                        onSelect={handleVehicleSelect}
                        usageCounts={usageCounts}
                        destinationRef={destinationRef}
                    />

                    {/* 목적지 (최대 5개 · POI 검색 · 즐겨찾기/최근) */}
                    <div>
                        <DestinationInput
                            ref={destinationRef}
                            destination={form.destination}
                            onChangeDestination={handleDestinationChange}
                            favorites={favorites}
                            recentDestinations={recentDestinations}
                            showFavSave={showFavSave}
                            setShowFavSave={setShowFavSave}
                            favName={favName}
                            setFavName={setFavName}
                            onSaveFavorite={handleSaveFavorite}
                        />
                        <RouteInfoPanel
                            routeInfo={routeInfo}
                            routeLoading={routeLoading}
                            freeRoadRoute={freeRoadRoute}
                            freeRoadLoading={freeRoadLoading}
                            onFetchFreeRoad={handleFetchFreeRoad}
                            departureSiteName={departureSiteName}
                        />
                    </div>

                    {/* 목적 */}
                    <div>
                        <label className="label text-sm font-medium">📝 목적</label>
                        <input
                            type="text"
                            value={form.purpose}
                            onChange={e => setForm({ ...form, purpose: e.target.value })}
                            className="input w-full mt-1 text-sm min-h-[48px]"
                            placeholder="출장, 외근 등"
                        />
                    </div>

                    {/* 동승자 — 예약 폼과 같은 입력. 기본은 접혀 있다.
                        여기 값은 운행일지 작성 화면의 초기값이 되고, 확정 기록은 운행일지다. */}
                    {passengerOptions.enabled && (
                        <ReservationPassengerField
                            values={form}
                            onChange={handlePassengerChange}
                            members={members}
                            allowList={passengerOptions.allowList}
                            allowSearch={passengerOptions.allowSearch}
                            allowCount={passengerOptions.allowCount}
                            hint="지금 함께 타는 인원입니다. 운행일지를 쓸 때 자동으로 채워지고, 도착 후 그때 확정합니다."
                        />
                    )}

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
        </div>
    );
}
