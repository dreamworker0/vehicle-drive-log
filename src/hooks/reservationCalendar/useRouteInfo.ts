import { useState, useEffect, useRef, useCallback } from 'react';
import { getMultiRouteWithFreeRoad, getFreeRoadRoute, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../../lib/tmap';
import { calcEndTime } from '../utils/reservationUtils';
import type { Vehicle } from '../../types/vehicle';
import type { ReservationForm } from '../../types/reservation';

export interface RouteInfoData {
    distance: number;
    duration: number;
    tollFee?: number;
    hasToll?: boolean;
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
    const [freeRoadRoute, setFreeRoadRoute] = useState<{ distance: number; duration: number; tollFee: number } | null>(null);
    const [freeRoadLoading, setFreeRoadLoading] = useState(false);

    // 마지막 경로 탐색에 사용한 파라미터를 ref로 보관 (on-demand 재사용)
    const lastRouteParamsRef = useRef<{ origin: string; destination: string; carType: string } | null>(null);

    // 경로 정보 업데이트 (기관 주소 → 목적지 경로 탐색)
    useEffect(() => {
        if (!form.destination.trim() || !orgAddress || !isTmapAvailable()) {
            setRouteInfo(null);
            setFreeRoadRoute(null);
            return;
        }

        // 선택된 차량의 carType 결정
        const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
        const carType = selectedVehicle?.vehicleType
            ? VEHICLE_TYPE_TO_CAR_TYPE[selectedVehicle.vehicleType] || '0'
            : '0';

        // 목적지/차량 변경 시 무료도로 초기화
        setFreeRoadRoute(null);

        const timer = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const result = await getMultiRouteWithFreeRoad(orgAddress, form.destination.trim(), { carType });
                if (result) {
                    setRouteInfo({
                        distance: result.distance,
                        duration: result.duration,
                        tollFee: result.tollFee,
                        hasToll: result.hasToll,
                    });
                    lastRouteParamsRef.current = { origin: orgAddress, destination: form.destination.trim(), carType };
                } else {
                    setRouteInfo(null);
                    lastRouteParamsRef.current = null;
                }
            } catch {
                setRouteInfo(null);
                lastRouteParamsRef.current = null;
            } finally {
                setRouteLoading(false);
            }
        }, 1200); // 충분한 디바운스로 불필요한 연속 호출 방지

        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.destination, form.vehicleId, orgAddress]);

    // 무료도로 경로 on-demand 조회 (펼치기 버튼 클릭 시 호출)
    const handleFetchFreeRoad = useCallback(async () => {
        if (!lastRouteParamsRef.current || freeRoadLoading) return;
        setFreeRoadLoading(true);
        try {
            const { origin, destination, carType } = lastRouteParamsRef.current;
            const result = await getFreeRoadRoute(origin, destination, { carType });
            setFreeRoadRoute(result);
        } catch {
            setFreeRoadRoute(null);
        } finally {
            setFreeRoadLoading(false);
        }
    }, [freeRoadLoading]);

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
        freeRoadRoute,
        freeRoadLoading,
        handleFetchFreeRoad,
    };
}
