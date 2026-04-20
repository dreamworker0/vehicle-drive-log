/**
 * useTodayDashboard — 오늘의 운행 대시보드 상태 + 로직
 * TodayDashboard에서 추출된 커스텀 훅
 *
 * 리팩토링: Mutation 핸들러 → useDashboardActions 분리
 */
/* eslint-disable react-compiler/react-compiler */
import { useState, useMemo, use } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getTodayReservations, getWeekReservations, getMyDriveLogs } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import { auth as firebaseAuth } from '../lib/firebase';
import { refreshTokenSilently } from '../lib/tokenRefresh';
import type { Vehicle } from '../types/vehicle';
import { isVehicleBlocked } from '../lib/vehicleUtils';
import type { Reservation, ReservationStatus } from '../types/reservation';
import type { FuelLog } from '../types/fuelLog';
import useDashboardActions from './useDashboardActions';

const EMPTY_VEHICLES: Vehicle[] = [];
const EMPTY_RESERVATIONS: Reservation[] = [];
const EMPTY_LOGS: FuelLog[] = [];

// React 19 Suspense 데이터 캐시
let globalDashboardCache: { key: string, promise: Promise<unknown>, data?: unknown } | null = null;

export function invalidateDashboardCache() {
    globalDashboardCache = null;
}

function getDashboardData(orgId: string, uid: string, todayStr: string, weekEndDate: string) {
    const key = `${orgId}-${uid}-${todayStr}`;
    
    // 캐시 히트 시 반환
    if (globalDashboardCache?.key === key) {
        if (globalDashboardCache.data) return globalDashboardCache.data as [Vehicle[], Reservation[], Reservation[], FuelLog[]];
        return globalDashboardCache.promise;
    }
    
    // 빈 데이터 Fallback (에러 시 사용)
    const EMPTY_FALLBACK: [Vehicle[], Reservation[], Reservation[], FuelLog[]] = [[], [], [], []];

    // 캐시 미스: 신규 페치
    const promise = Promise.all([
        getVehicles(orgId),
        getTodayReservations(orgId, todayStr),
        getWeekReservations(orgId, todayStr, weekEndDate),
        getMyDriveLogs(orgId, uid, 50),
    ]).then(async (res) => {
        globalDashboardCache!.data = res;
        return res;
    }).catch(async (err) => {
        const errCode = (err as { code?: string })?.code;
        if (errCode === 'permission-denied') {
            if (firebaseAuth.currentUser) {
                await refreshTokenSilently(firebaseAuth.currentUser);
            }
        }
        // 캐시 무효화하여 다음 렌더링에서 재시도할 수 있게 함
        globalDashboardCache = null;
        // use()에서 throw되지 않도록 빈 데이터를 반환 → UI는 "예약 없음" 상태로 표시
        console.warn('[TodayDashboard] 데이터 로드 실패, 빈 데이터로 대체:', errCode || err);
        return EMPTY_FALLBACK;
    });

    globalDashboardCache = { key, promise };
    return promise;
}

export default function useTodayDashboard() {
    const { user, userData } = useAuth();
    
    // 서버 데이터 업데이트(Mutations) 후 UI 동기화를 위한 로컬 오버라이드 상태
    const [localCancelledIds, setLocalCancelledIds] = useState<Set<string>>(new Set());
    const [localStartedIds, setLocalStartedIds] = useState<Map<string, string>>(new Map());

    const orgId = userData?.organizationId;
    const todayStr = useMemo(() => toLocalDateStr(), []);
    const weekEndDate = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return toLocalDateStr(d);
    }, []);

    // 1. 데이터 페칭 - Suspense 유발
    // use() 훅이 Promise 인스턴스를 받으면 Resolve 될 때까지 상위 Suspense로 렌더링을 중단합니다.
    const dataOrPromise = useMemo(() => {
        return (orgId && user?.uid) ? getDashboardData(orgId, user.uid, todayStr, weekEndDate) : null;
    }, [orgId, user?.uid, todayStr, weekEndDate]);
    type DashboardData = [Vehicle[], Reservation[], Reservation[], FuelLog[]];
    const resolvedData = (dataOrPromise instanceof Promise ? use(dataOrPromise) : dataOrPromise) as DashboardData | null;

    const serverVehicles: Vehicle[] = resolvedData ? resolvedData[0] : EMPTY_VEHICLES;
    const serverToday: Reservation[] = resolvedData ? resolvedData[1] : EMPTY_RESERVATIONS;
    const serverWeek: Reservation[] = resolvedData ? resolvedData[2] : EMPTY_RESERVATIONS;
    const myLogs = resolvedData ? resolvedData[3] : EMPTY_LOGS;

    // 2. 로컬 Override 반영
    const vehicles = serverVehicles;
    const todayReservations = useMemo(() => 
        serverToday
            .filter(r => !localCancelledIds.has(r.id))
            .map(r => localStartedIds.has(r.id) ? { ...r, status: 'in_progress' as ReservationStatus, actualStartTime: localStartedIds.get(r.id) } : r)
    , [serverToday, localCancelledIds, localStartedIds]);

    const weekReservations = useMemo(() => 
        serverWeek
            .filter(r => !localCancelledIds.has(r.id))
            .map(r => localStartedIds.has(r.id) ? { ...r, status: 'in_progress' as ReservationStatus, actualStartTime: localStartedIds.get(r.id) } : r)
    , [serverWeek, localCancelledIds, localStartedIds]);

    // 3. 파생 상태 연산
    const incompleteAlerts = useMemo(() => {
        if (!user?.uid) return [];
        const logReservationIds = new Set(myLogs.filter((l: FuelLog) => l.reservationId).map((l: FuelLog) => l.reservationId));
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toLocalDateStr(yesterday);

        return weekReservations
            .filter(res => res.reservedByUid === user.uid
                && (res.status === 'in_progress' || res.status === 'completed')
                && (res.date ?? '') <= yesterdayStr
                && !logReservationIds.has(res.id)
            ).map(res => ({ type: 'reservation' as const, ...res })) as (Reservation & { type: string })[];
    }, [weekReservations, myLogs, user?.uid]);

    const vehicleUsageCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const log of myLogs) {
            if (log.vehicleId) {
                counts.set(log.vehicleId, (counts.get(log.vehicleId) || 0) + 1);
            }
        }
        return counts;
    }, [myLogs]);

    const myReservations = useMemo(() =>
        todayReservations
            .filter(r => r.reservedByUid === user?.uid && r.status !== 'completed')
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
        [todayReservations, user?.uid]
    );

    const weekGrouped = useMemo(() => {
        const myWeek = weekReservations
            .filter(r => r.reservedByUid === user?.uid && r.date !== todayStr && r.status !== 'completed')
            .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
        const grouped: Record<string, Reservation[]> = {};
        myWeek.forEach(r => {
            if (!grouped[r.date]) grouped[r.date] = [];
            grouped[r.date].push(r);
        });
        return grouped;
    }, [weekReservations, user?.uid, todayStr]);

    // 30분 이내 임박 예약 감지
    const upcomingAlerts = useMemo(() => {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        return myReservations.filter(r => {
            if (r.status !== 'reserved' || !r.startTime) return false;
            const [h, m] = r.startTime.split(':').map(Number);
            const startMin = h * 60 + m;
            const diff = startMin - nowMin;
            return diff > 0 && diff <= 30;
        });
    }, [myReservations]);

    // 현재 운행 중인 예약이 있는지 여부 (동시 운행 시작 방지)
    const hasActiveDrive = useMemo(() =>
        myReservations.some(r => r.status === 'in_progress'),
        [myReservations]
    );

    // 추천 차량: 자주 타는 차량 중 예약이 비어있는 차량 우선
    const recommendedVehicle = useMemo(() => {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const twoHoursLater = nowMin + 120;

        const candidates = vehicles.filter(v => !isVehicleBlocked(v.maintenance) && !v.retired?.isRetired).map(v => {
            const vReservations = todayReservations
                .filter(r => r.vehicleId === v.id && r.status !== 'completed' && r.status !== 'cancelled')
                .map(r => {
                    const [sh, sm] = (r.startTime || '00:00').split(':').map(Number);
                    const [eh, em] = (r.endTime || '23:59').split(':').map(Number);
                    return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
                })
                .sort((a, b) => a.startMin - b.startMin);

            const hasNearReservation = vReservations.some(r =>
                r.startMin <= twoHoursLater && r.endMin > nowMin
            );
            if (hasNearReservation) return null;

            const nextReservation = vReservations.find(r => r.startMin > nowMin);
            const minutesUntilNext = nextReservation
                ? nextReservation.startMin - nowMin
                : Infinity;

            const usageCount = vehicleUsageCounts.get(v.id) || 0;

            return { ...v, minutesUntilNext, usageCount };
        }).filter(Boolean);

        if (candidates.length === 0) return null;
        return candidates.sort((a, b) => {
            const freqDiff = (b?.usageCount ?? 0) - (a?.usageCount ?? 0);
            if (freqDiff !== 0) return freqDiff;
            return (b?.minutesUntilNext ?? 0) - (a?.minutesUntilNext ?? 0);
        })[0];
    }, [vehicles, todayReservations, vehicleUsageCounts]);

    // 자주 타는 차량 정렬 (첫 번째 차량 추출용)
    const sortedActiveVehicles = useMemo(() => {
        return vehicles
            .filter(v => !v.retired?.isRetired)
            .sort((a, b) => {
                const countDiff = (vehicleUsageCounts.get(b.id) || 0) - (vehicleUsageCounts.get(a.id) || 0);
                if (countDiff !== 0) return countDiff;
                return (a.name || '').localeCompare(b.name || '');
            });
    }, [vehicles, vehicleUsageCounts]);

    const firstVehicleId = sortedActiveVehicles.length > 0 ? sortedActiveVehicles[0].id : undefined;

    // 4. Mutation 핸들러 (분리된 훅 사용)
    const {
        startingId, cancellingId,
        handleStartDrive, handleStartNavigation,
        handleCancelReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
    } = useDashboardActions({
        vehicles,
        firstVehicleId,
        setLocalStartedIds,
        setLocalCancelledIds,
    });

    const todayLabel = useMemo(() =>
        new Date().toLocaleDateString('ko-KR', {
            month: 'long', day: 'numeric', weekday: 'long',
        })
    , []);

    return {
        vehicles, startingId, cancellingId,
        myReservations, weekGrouped, todayLabel,
        upcomingAlerts, incompleteAlerts, hasActiveDrive,
        handleStartDrive, handleStartNavigation,
        // 통합된 취소 핸들러 (기존 두 개 유지 → 동일 함수 참조)
        handleCancelWeekReservation: handleCancelReservation,
        handleCancelTodayReservation: handleCancelReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
        recommendedVehicle, myLogsCount: myLogs.length,
    };
}
