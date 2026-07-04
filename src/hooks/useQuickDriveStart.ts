/**
 * useQuickDriveStart — 예약없는 출발 시작 페이지의 상태 + 로직
 * 차량 선택, 목적지, 목적 입력 후 in_progress 예약 생성
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getVehicles, getFavorites, getOrganization, createReservationSafe, updateReservationStatus } from '../lib/firestore';
import { getMultiRouteWithFreeRoad, getFreeRoadRoute, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../lib/tmap';
import type { Favorite } from '../types/favorite';
import { calcEndTime } from './utils/reservationUtils';
import { toLocalDateStr } from '../lib/dateUtils';
import type { Vehicle } from '../types/vehicle';
import { isVehicleBlocked, isVehicleRestrictedForUser } from '../lib/vehicleUtils';
import type { Organization } from '../types/organization';
import { invalidateDashboardCache } from './useTodayDashboard';

export default function useQuickDriveStart() {
    const { user, userData } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const recommendedVehicleId = location.state?.recommendedVehicleId || null;

    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number; tollFee?: number; hasToll?: boolean } | null>(null);
    const [routeLoading, setRouteLoading] = useState(false);
    const [freeRoadRoute, setFreeRoadRoute] = useState<{ distance: number; duration: number; tollFee: number } | null>(null);
    const [freeRoadLoading, setFreeRoadLoading] = useState(false);
    const [orgAddress, setOrgAddress] = useState('');
    const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastRouteParamsRef = useRef<{ origin: string; destination: string; carType: string } | null>(null);

    const [form, setForm] = useState({
        vehicleId: '',
        vehicleName: '',
        destination: '',
        purpose: '',
    });

    const orgId = userData?.organizationId;

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetch = async () => {
            try {
                // 모바일 백그라운드 복귀 시 Firebase 토큰 만료에 따른 Unauthenticated 에러 방지
                if (user) {
                    await user.getIdToken();
                }

                const [v, favs, org] = await Promise.all([
                    getVehicles(orgId),
                    getFavorites(user!.uid),
                    getOrganization(orgId),
                ]);
                setVehicles(v as Vehicle[]);
                setFavorites(favs as Favorite[]);
                if ((org as Organization | null)?.address) setOrgAddress((org as Organization).address ?? '');

                // 정비 중·사용 제한 차량 제외한 목록
                const availableVehicles = v.filter(veh =>
                    !isVehicleBlocked(veh.maintenance) && !veh.retired?.isRetired &&
                    !isVehicleRestrictedForUser(veh, user?.uid, userData?.role)
                );

                // 추천 차량 자동 선택 (정비 중이 아닌 차량만)
                if (recommendedVehicleId) {
                    const rv = availableVehicles.find(veh => veh.id === recommendedVehicleId);
                    if (rv) {
                        setForm(prev => ({
                            ...prev,
                            vehicleId: rv.id,
                            vehicleName: rv.displayName ?? '',
                        }));
                    }
                } else if (availableVehicles.length === 1) {
                    setForm(prev => ({
                        ...prev,
                        vehicleId: availableVehicles[0].id,
                        vehicleName: availableVehicles[0].displayName ?? '',
                    }));
                }
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, user?.uid, recommendedVehicleId]);

    // 목적지 또는 차량 변경 시 경로 탐색 (디바운스 800ms)
    useEffect(() => {
        if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
        setRouteInfo(null);
        setFreeRoadRoute(null);

        if (!form.destination.trim() || !orgAddress || !isTmapAvailable()) return;

        routeTimerRef.current = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const selectedV = vehicles.find(v => v.id === form.vehicleId);
                const carType = VEHICLE_TYPE_TO_CAR_TYPE[selectedV?.vehicleType ?? ''] || '0';

                const result = await getMultiRouteWithFreeRoad(orgAddress, form.destination.trim(), { carType });
                if (result) {
                    setRouteInfo({ distance: result.distance, duration: result.duration, tollFee: result.tollFee, hasToll: result.hasToll });
                    lastRouteParamsRef.current = { origin: orgAddress, destination: form.destination.trim(), carType };
                } else {
                    setRouteInfo(null);
                    lastRouteParamsRef.current = null;
                }
            } catch (err) {
                console.error('경로 탐색 실패:', err);
                lastRouteParamsRef.current = null;
            } finally {
                setRouteLoading(false);
            }
        }, 800);

        return () => {
            if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
        };
    }, [form.destination, form.vehicleId, orgAddress, vehicles]);

    // 무료도로 경로 on-demand 조회 (펼치기 버튼 클릭 시 호출)
    const handleFetchFreeRoad = useCallback(async () => {
        if (!lastRouteParamsRef.current || freeRoadLoading) return;
        setFreeRoadLoading(true);
        try {
            const { origin, destination, carType } = lastRouteParamsRef.current;
            const result = await getFreeRoadRoute(origin, destination, { carType });
            setFreeRoadRoute(result);
        } catch (err) {
            console.error('무료도로 탐색 실패:', err);
            setFreeRoadRoute(null);
        } finally {
            setFreeRoadLoading(false);
        }
    }, [freeRoadLoading]);

    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);

    const handleVehicleSelect = (vehicleId: string) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        setForm(prev => ({
            ...prev,
            vehicleId,
            vehicleName: v?.displayName || '',
        }));
    };

    const handleFavoriteSelect = (fav: Favorite) => {
        setForm(prev => ({ ...prev, destination: fav.address || fav.name }));
    };

    const handleStart = async () => {
        if (!form.vehicleId) {
            showToast('차량을 선택해주세요.', 'warning');
            return;
        }
        if (!form.destination.trim()) {
            showToast('목적지를 입력해주세요.', 'warning');
            return;
        }
        // 차량별 사용 가능 직원 제한 검증 (UI 비활성의 방어적 이중 체크, 서버 콜러블에서도 재검증됨)
        if (selectedVehicle && isVehicleRestrictedForUser(selectedVehicle, user?.uid, userData?.role)) {
            showToast('이 차량은 지정된 직원만 운행할 수 있습니다.', 'warning');
            return;
        }

        setSubmitting(true);
        try {
            const now = new Date();
            const actualStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const todayStr = toLocalDateStr();

            // Cloud Function으로 예약 생성 (중복 방지 + 서버 검증)
            const result = await createReservationSafe({
                organizationId: orgId!,
                vehicleId: form.vehicleId,
                vehicleName: form.vehicleName,
                reservedByUid: user!.uid,
                reservedByName: userData?.name || user!.displayName || user!.email || '',
                date: todayStr,
                startTime: actualStartTime,
                endTime: calcEndTime(actualStartTime, routeInfo?.duration || 0),
                purpose: form.purpose.trim(),
                destination: form.destination.trim(),
                routeDistance: routeInfo?.distance ?? undefined,
                routeDuration: routeInfo?.duration ?? undefined,
                routeTollFee: routeInfo?.tollFee ?? undefined,
                isQuickDrive: true,
            });
            const reservationId = result;

            // 즉시 in_progress로 상태 변경
            await updateReservationStatus(reservationId, 'in_progress', { actualStartTime });

            showToast('운행이 시작되었습니다!', 'success');
            invalidateDashboardCache();
            navigate('/employee/today', { replace: true });
        } catch (err) {
            console.error('운행 시작 실패:', err);
            // Cloud Function의 중복 예약 에러 → 구체적인 사유 표시
            const errObj = err as Record<string, string>;
            if (errObj?.code === 'functions/already-exists' || errObj?.message?.includes('이미 예약')) {
                showToast(errObj.message || '해당 시간대에 이미 예약이 있습니다.', 'warning');
            } else {
                showToast('운행 시작에 실패했습니다. 다시 시도해주세요.', 'error');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return {
        form, setForm,
        vehicles, favorites,
        loading, submitting,
        selectedVehicle,
        routeInfo, routeLoading,
        freeRoadRoute, freeRoadLoading, handleFetchFreeRoad,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleStart,
    };
}
