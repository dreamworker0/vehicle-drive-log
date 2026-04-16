import { useState, useEffect } from 'react';
import { getMultiRouteWithFreeRoad, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../../lib/tmap';
import { calcEndTime } from '../utils/reservationUtils';
import type { Vehicle } from '../../types/vehicle';
import type { ReservationForm } from '../../types/reservation';

export interface RouteInfoData {
    distance: number;
    duration: number;
    tollFee?: number;
    freeRoadRoute?: { distance: number; duration: number; tollFee: number };
}

interface UseRouteInfoParams {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    orgAddress: string;
    vehicles: Vehicle[];
}

export function useRouteInfo({ form, setForm, orgAddress, vehicles }: UseRouteInfoParams) {
    const [routeInfo, setRouteInfo] = useState<RouteInfoData | null>(null);
    const [routeLoading, setRouteLoading] = useState(false);

    // 경로 정보 업데이트 (기관 주소 → 목적지 경로 탐색)
    useEffect(() => {
        if (!form.destination.trim() || !orgAddress || !isTmapAvailable()) {
            setRouteInfo(null);
            return;
        }

        // 선택된 차량의 carType 결정
        const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
        const carType = selectedVehicle?.vehicleType
            ? VEHICLE_TYPE_TO_CAR_TYPE[selectedVehicle.vehicleType] || '0'
            : '0';

        const timer = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const result = await getMultiRouteWithFreeRoad(orgAddress, form.destination.trim(), { carType });
                if (result) {
                    setRouteInfo({
                        distance: result.distance,
                        duration: result.duration,
                        tollFee: result.tollFee,
                        freeRoadRoute: result.freeRoadRoute,
                    });
                } else {
                    setRouteInfo(null);
                }
            } catch {
                setRouteInfo(null);
            } finally {
                setRouteLoading(false);
            }
        }, 1200); // 충분한 디바운스로 불필요한 연속 호출 방지

        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.destination, form.vehicleId, orgAddress]);

    // startTime 변경 시 도착 시간 자동 계산 (API 재호출 없음)
    useEffect(() => {
        if (form.startTime && routeInfo?.duration) {
            const autoEnd = calcEndTime(form.startTime, routeInfo.duration);
            setForm(prev => ({ ...prev, endTime: autoEnd }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.startTime, routeInfo?.duration]);

    return {
        routeInfo,
        setRouteInfo,
        routeLoading,
    };
}
