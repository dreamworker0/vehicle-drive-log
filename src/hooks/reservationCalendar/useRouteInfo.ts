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
    /**
     * 종료시간을 **사람이 정했는가.** true면 자동으로 덮지 않는다.
     *
     * 수정 화면을 열기만 해도 저장돼 있던 종료시간이 덮이던 자리다(2026-09-16 이용 기관 신고 2건).
     * 목적지가 이미 채워져 있으니 경로 조회가 돌고, 1.2초 뒤 결과가 오면서 조용히 갈아치웠다.
     */
    endTimeTouched: boolean;
}

export function useRouteInfo({ form, setForm, orgAddress, orgSites, vehicles, endTimeTouched }: UseRouteInfoParams) {
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

        // 경로가 바뀌었는데 옛 조회 결과가 남아 있으면, 그것이 자동 채움·제안의 근거가 된다.
        // routeInfo는 이 훅이 떠 있는 동안 살아 있어서, 신규 폼에서 한 번 조회한 뒤 수정 화면을
        // 열면 **옛 목적지의 소요시간**으로 종료시간이 잡혔다. 파라미터가 실제로 달라졌을 때만
        // 비운다 — 매 실행마다 비우면 같은 경로에서도 패널이 깜빡인다.
        const last = lastRouteParamsRef.current;
        if (last && (last.origin !== origin || last.destination !== form.destination.trim() || last.carType !== carType)) {
            setRouteInfo(null);
            lastRouteParamsRef.current = null;
        }

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

    /**
     * 종료시간이 여러 날에 걸쳐 있는 예약인가.
     *
     * 다일 예약의 종료시간 칸은 **마지막 날의 종료**를 담는데(editActions의 `endTime: last.endTime`),
     * 자동 계산은 **첫날 시작** 기준이라 둘의 뜻이 다르다. 그대로 채우면 3일짜리 예약이 하루로
     * 줄어든 채 저장된다. 반복 예약도 같은 이유로 제외한다.
     */
    const isSpanningDays = !!form.endDate || !!form.isRecurring;

    // 경로 소요시간·시작시간이 바뀌면 종료시간을 자동으로 채운다 (API 재호출 없음).
    // **사람이 정한 값은 덮지 않는다** — 대신 아래 suggestedEndTime으로 제안만 한다.
    useEffect(() => {
        if (endTimeTouched || isSpanningDays) return;
        if (form.startTime && routeInfo?.duration) {
            const autoEnd = calcEndTime(form.startTime, routeInfo.duration);
            setForm(prev => ({ ...prev, endTime: autoEnd }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.startTime, routeInfo?.duration, endTimeTouched, isSpanningDays]);

    /**
     * 화면에 권할 종료시간 — 없으면 `null`.
     *
     * 자동으로 채운 경우에는 계산값과 폼의 값이 같아져 저절로 `null`이 된다. 그래서 이 값이
     * 뜨는 것은 사실상 **사람이 정해 둔 값과 경로 계산이 어긋날 때**뿐이다.
     */
    const suggestedEndTime = (() => {
        if (isSpanningDays || routeLoading) return null;
        if (!form.startTime || !routeInfo?.duration) return null;
        const candidate = calcEndTime(form.startTime, routeInfo.duration);
        return candidate === form.endTime ? null : candidate;
    })();

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
        /** 경로 기준 권장 종료시간 — 덮어쓰지 않고 화면에서 제안만 한다. 없으면 null */
        suggestedEndTime,
        freeRoadRoute,
        freeRoadLoading,
        handleFetchFreeRoad,
    };
}
