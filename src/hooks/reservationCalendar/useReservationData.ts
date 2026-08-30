import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getVehicles,
    getReservationsByDateRange,
    getOrganizationMembers,
    getOrganization,
    getFavorites,
} from '../../lib/firestore';
import { getHolidays } from '../../lib/holiday';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { useCalendarSync } from '../useCalendarSync';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation, CalendarDay } from '../../types/reservation';
import type { CustomHoliday } from '../../types/holiday';
import type { Favorite } from '../../types/favorite';
import type { User as UserDoc } from '../../types/user';

interface UseReservationDataParams {
    user: { uid: string } | null;
    userData: { organizationId?: string | null; name?: string } | null;
    isAdmin: boolean;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    currentMonth: Date;
    /** 예약 동승자 입력이 켜진 기관인지 — 켜져 있으면 일반 직원도 직원 목록이 필요하다 */
    needsMembers?: boolean;
}

export function useReservationData({
    user,
    userData,
    isAdmin,
    showToast,
    currentMonth,
    needsMembers = false,
}: UseReservationDataParams) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [holidays, setHolidays] = useState<CustomHoliday[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);
    const [orgAddress, setOrgAddress] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

    const { syncVehicleOnDemand, checkCooldown, getLastSyncTime } = useCalendarSync();

    // userData는 useAuth의 onSnapshot이 매 스냅샷마다 새 객체로 갈아끼운다(테마 변경 등 무관한
    // 필드 쓰기 포함). 객체 자체를 effect 의존성에 두면 그때마다 차량/즐겨찾기/기관/직원 목록을
    // 통째로 재조회하므로, 실제로 필요한 원시값(uid, organizationId)만 뽑아 의존한다.
    const uid = user?.uid;
    const orgId = userData?.organizationId;

    // 캘린더 연동 차량 목록 (유효한 구글 캘린더 ID 보유)
    const calendarLinkedVehicles = useMemo(
        () => vehicles.filter(v => v.googleCalendarId && v.googleCalendarId.includes('@')),
        [vehicles]
    );

    // 차량 로드 후 저장된 마지막 동기화 시각 복원
    useEffect(() => {
        if (calendarLinkedVehicles.length === 0) return;
        setLastSyncAt(getLastSyncTime(calendarLinkedVehicles.map(v => v.id)));
    }, [calendarLinkedVehicles, getLastSyncTime]);

    // 초기 데이터 로드
    useEffect(() => {
        if (!uid || !orgId) { setLoading(false); return; }

        // 공휴일은 화면을 막지 않는다.
        // Firestore(system/holidays)에 해당 연도가 없으면 외부 공공데이터 API로 폴백하는데,
        // 이것을 아래 Promise.all에 넣어 await하면 외부 API가 늦을 때 예약 화면 전체가
        // 스피너에 갇힌다. 공휴일은 달력의 부가 표시일 뿐이라 늦게 채워져도 무방하다.
        let holidayCancelled = false;
        getHolidays()
            .then((hList) => { if (!holidayCancelled) setHolidays(hList as CustomHoliday[]); })
            .catch((error) => {
                // 실패해도 토스트를 띄우지 않는다 — 사용자가 할 수 있는 일이 없고,
                // 공휴일 표시가 빠지는 것 외에 예약 기능에는 영향이 없다.
                console.error('공휴일 로드 실패:', error);
            });

        const fetchData = async () => {
            try {
                setLoading(true);
                const [vList, fList, org] = await Promise.all([
                    getVehicles(orgId),
                    getFavorites(uid),
                    getOrganization(orgId)
                ]);
                setVehicles(vList as Vehicle[]);
                setFavorites(fList as Favorite[]);
                if (org?.address) {
                    setOrgAddress(org.address);
                }

                // 관리자는 예약자 대리 지정에, 일반 직원은 동승자 선택에 직원 목록이 필요하다.
                // 동승자 입력을 끈 기관에서는 이 읽기가 늘지 않는다.
                if (isAdmin || needsMembers) {
                    const mList = await getOrganizationMembers(orgId);
                    setMembers(mList as UserDoc[]);
                }
            } catch (error) {
                console.error('Data fetch error:', error);
                showToast('데이터를 불러오는데 실패했습니다.', 'error');
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // 비차단으로 돌린 공휴일 로드가 언마운트 후 setState하지 않게 한다.
        return () => { holidayCancelled = true; };
    }, [uid, orgId, isAdmin, needsMembers, showToast]);

    // 예약 목록 로드 함수 분리 (재사용 목적)
    const fetchReservations = useCallback(() => {
        if (!orgId) return;

        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

        getReservationsByDateRange(orgId, start, end)
            .then(res => setReservations(res as Reservation[]))
            .catch(err => console.error('Reservation fetch error:', err));
    }, [currentMonth, orgId]);

    // 예약 목록 로드 (월 변경 시)
    useEffect(() => {
        fetchReservations();
    }, [fetchReservations]);

    // 구글 캘린더 온디맨드 백그라운드 동기화 트리거
    useEffect(() => {
        if (!userData?.organizationId || calendarLinkedVehicles.length === 0) return;

        const triggerSyncs = async () => {
            let anySynced = false;
            for (const vehicle of calendarLinkedVehicles) {
                // 30분 쿨다운을 지난 경우 백그라운드 동기화 자동 시작
                if (checkCooldown(vehicle.id)) {
                    // 정보성 로그는 개발 모드에서만 — 프로덕션 콘솔 노이즈·차량 정보 노출 방지
                    if (import.meta.env.DEV) console.log(`[useReservationData] Triggering background calendar sync for ${vehicle.displayName} (${vehicle.id})`);
                    const success = await syncVehicleOnDemand(vehicle.id, userData.organizationId!);
                    if (success) {
                        anySynced = true;
                    }
                }
            }
            // 하나라도 성공했으면 예약을 즉시 리프레시하여 실시간 반영
            if (anySynced) {
                if (import.meta.env.DEV) console.log('[useReservationData] Calendar sync completed, refreshing reservations...');
                fetchReservations();
                setLastSyncAt(Date.now());
            }
        };

        triggerSyncs();
    }, [calendarLinkedVehicles, userData?.organizationId, syncVehicleOnDemand, checkCooldown, fetchReservations]);

    // 수동 "지금 동기화" — 쿨다운을 우회하여 연동 차량 전체를 즉시 동기화
    const syncNow = useCallback(async () => {
        if (!userData?.organizationId || calendarLinkedVehicles.length === 0 || syncing) return;

        setSyncing(true);
        try {
            let anySynced = false;
            for (const vehicle of calendarLinkedVehicles) {
                const success = await syncVehicleOnDemand(vehicle.id, userData.organizationId!, { force: true });
                if (success) anySynced = true;
            }
            if (anySynced) {
                fetchReservations();
                setLastSyncAt(Date.now());
                showToast('구글 캘린더 동기화가 완료되었습니다.', 'success');
            } else {
                showToast('동기화하지 못했습니다. 캘린더 공유 설정을 확인해주세요.', 'warning');
            }
        } finally {
            setSyncing(false);
        }
    }, [userData?.organizationId, calendarLinkedVehicles, syncing, syncVehicleOnDemand, fetchReservations, showToast]);

    // 달력 데이터 생성
    const calendarDays = useMemo(() => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        const days = eachDayOfInterval({ start, end });

        const prefix = Array(start.getDay()).fill(null);

        return [...prefix, ...days.map(d => {
            const dStr = format(d, 'yyyy-MM-dd');
            return {
                date: d.getDate(),
                dateStr: dStr,
                reservations: reservations.filter(r => r.date === dStr && r.status !== 'cancelled'),
                holiday: holidays.find(h => h.date === dStr)?.name || null
            };
        })] as (CalendarDay | null)[];
    }, [currentMonth, reservations, holidays]);

    return {
        vehicles,
        reservations,
        setReservations,
        loading,
        favorites,
        setFavorites,
        holidays,
        members,
        orgAddress,
        calendarDays,
        syncNow,
        syncing,
        lastSyncAt,
    };
}
