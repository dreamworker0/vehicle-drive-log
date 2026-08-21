import { useState, useEffect, useRef, useCallback } from 'react';
import { getMultiRouteWithFreeRoad, getFreeRoadRoute, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../../lib/tmap';
import { calcEndTime } from '../utils/reservationUtils';
import { resolveDepartureAddress, resolveVehicleSite, hasBranchSites, type OrgSite } from '../../lib/orgSites';
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
    /** 기관의 출발지 목록(본관 + 분관) */
    orgSites: OrgSite[];
    vehicles: Vehicle[];
}

export function useRouteInfo({ form, setForm, orgAddress, orgSites, vehicles }: UseRouteInfoParams) {
    const [routeInfo, setRouteInfo] = useState<RouteInfoData | null>(null);
    const [routeLoading, setRouteLoading] = useState(false);
    const [freeRoadRoute, setFreeRoadRoute] = useState<{ distance: number; duration: number; tollFee: number } | null>(null);
    const [freeRoadLoading, setFreeRoadLoading] = useState(false);

    // 마지막 경로 탐색에 사용한 파라미터를 ref로 보관 (on-demand 재사용)
    const lastRouteParamsRef = useRef<{ origin: string; destination: string; carType: string } | null>(null);

    // 경로 정보 업데이트 (차량이 세워져 있는 출발지 → 목적지 경로 탐색)
    useEffect(() => {
        // 선택된 차량의 출발지·carType 결정. 분관 차량은 분관 주소에서 출발한다 —
        // 본관 주소로 계산하면 거리·소요시간·통행료가 전부 어긋난다.
        const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
        const origin = resolveDepartureAddress(orgSites, selectedVehicle) || orgAddress;

        if (!form.destination.trim() || !origin || !isTmapAvailable()) {
            setRouteInfo(null);
            setFreeRoadRoute(null);
            return;
        }

        const carType = selectedVehicle?.vehicleType
            ? VEHICLE_TYPE_TO_CAR_TYPE[selectedVehicle.vehicleType] || '0'
            : '0';

        // 목적지/차량 변경 시 무료도로 초기화
        setFreeRoadRoute(null);

        const timer = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const result = await getMultiRouteWithFreeRoad(origin, form.destination.trim(), { carType });
                if (result) {
                    setRouteInfo({
                        distance: result.distance,
                        duration: result.duration,
                        tollFee: result.tollFee,
                        hasToll: result.hasToll,
                    });
                    lastRouteParamsRef.current = { origin, destination: form.destination.trim(), carType };
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
    }, [form.destination, form.vehicleId, orgAddress, orgSites]);

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

    // 분관을 등록한 기관에서만 출발지를 화면에 알린다(본관뿐이면 새 정보가 없다).
    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    const departureSiteName = hasBranchSites(orgSites)
        ? resolveVehicleSite(orgSites, selectedVehicle).name
        : '';

    return {
        /** 선택한 차량의 출발지 이름 — 분관이 없는 기관에서는 빈 문자열 */
        departureSiteName,
        routeInfo,
        setRouteInfo,
        routeLoading,
        freeRoadRoute,
        freeRoadLoading,
        handleFetchFreeRoad,
    };
}
