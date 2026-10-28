/**
 * useTodayDashboard — 오늘의 운행 대시보드 상태 + 로직
 * TodayDashboard에서 추출된 커스텀 훅
 *
 * 리팩토링: Mutation 핸들러 → useDashboardActions 분리
 */

import { useState, useMemo, useCallback, useEffect, useRef, use } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getWeekReservations, getMyDriveLogs, updateReservationStatus } from '../lib/firestore';
import { captureError } from '../lib/sentry';
import { toLocalDateStr } from '../lib/dateUtils';
import { auth as firebaseAuth } from '../lib/firebase';
import { refreshTokenSilently } from '../lib/tokenRefresh';
import type { Vehicle } from '../types/vehicle';
import { isVehicleBlocked } from '../lib/vehicleUtils';
import type { Reservation, ReservationStatus } from '../types/reservation';
import type { DriveLog } from '../types/driveLog';
import useDashboardActions from './useDashboardActions';

const EMPTY_VEHICLES: Vehicle[] = [];
const EMPTY_RESERVATIONS: Reservation[] = [];
const EMPTY_LOGS: DriveLog[] = [];

/**
 * 대시보드 데이터 + **불러오지 못했다는 사실**.
 *
 * 실패해도 throw하지 않고 빈 데이터를 돌려주기 때문에(상위 ErrorBoundary로 튀지 않게),
 * `loadFailed` 없이는 화면이 "예약이 없다"와 "못 받아 왔다"를 구분할 수 없다.
 * 실제로 인덱스가 빌드되는 5분 사이 운전자 한 명이 자기 예약을 "예약 없음"으로 봤다(Phase 220).
 */
interface DashboardData {
    vehicles: Vehicle[];
    today: Reservation[];
    week: Reservation[];
    logs: DriveLog[];
    loadFailed: boolean;
}

// React 19 Suspense 데이터 캐시
let globalDashboardCache: { key: string, promise: Promise<unknown>, data?: unknown } | null = null;

export function invalidateDashboardCache() {
    globalDashboardCache = null;
}

function getDashboardData(orgId: string, uid: string, todayStr: string, weekEndDate: string) {
    const key = `${orgId}-${uid}-${todayStr}`;
    
    // 캐시 히트 시 반환
    if (globalDashboardCache?.key === key) {
        if (globalDashboardCache.data) return globalDashboardCache.data as DashboardData;
        return globalDashboardCache.promise;
    }

    // 실패 시 대체값 — 데이터는 비어 있고, 비어 있는 이유가 실패임을 함께 들고 간다.
    const EMPTY_FALLBACK: DashboardData = {
        vehicles: [], today: [], week: [], logs: [], loadFailed: true,
    };

    // 캐시 미스: 신규 페치
    // 오늘 예약은 주간(오늘~+7일) 결과의 부분집합이므로 별도 쿼리 없이 파생한다 (read 중복 제거).
    // 두 함수의 취소 제외 필터가 동일해 getTodayReservations와 결과가 같다.
    const promise = Promise.all([
        getVehicles(orgId),
        getWeekReservations(orgId, todayStr, weekEndDate),
        getMyDriveLogs(orgId, uid, 50),
    ]).then(async ([vehicles, week, logs]) => {
        const today = week.filter(r => r.date === todayStr);
        const res: DashboardData = { vehicles, today, week, logs, loadFailed: false };
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
        // use()에서 throw되지 않도록 빈 데이터를 반환 → 상위 ErrorBoundary로 튀지 않는다.
        // 대신 loadFailed로 "못 받아 왔다"를 UI까지 전달한다(빈 결과와 구분해야 한다).
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

    // 캐시 무효화 + 재페치 트리거 (캘린더 백그라운드 동기화 후 갱신용)
    const [refreshTick, setRefreshTick] = useState(0);
    const refresh = useCallback(() => {
        invalidateDashboardCache();
        setRefreshTick(t => t + 1);
    }, []);

    // 1. 데이터 페칭 - Suspense 유발
    // use() 훅이 Promise 인스턴스를 받으면 Resolve 될 때까지 상위 Suspense로 렌더링을 중단합니다.
    const dataOrPromise = useMemo(() => {
        void refreshTick; // 캐시 무효화 후 재페치를 강제하기 위한 의존성
        return (orgId && user?.uid) ? getDashboardData(orgId, user.uid, todayStr, weekEndDate) : null;
    }, [orgId, user, todayStr, weekEndDate, refreshTick]);
    const resolvedData = (dataOrPromise instanceof Promise ? use(dataOrPromise) : dataOrPromise) as DashboardData | null;

    const serverVehicles: Vehicle[] = resolvedData ? resolvedData.vehicles : EMPTY_VEHICLES;
    const serverToday: Reservation[] = resolvedData ? resolvedData.today : EMPTY_RESERVATIONS;
    const serverWeek: Reservation[] = resolvedData ? resolvedData.week : EMPTY_RESERVATIONS;
    const myLogs = resolvedData ? resolvedData.logs : EMPTY_LOGS;
    // 아직 orgId/uid가 없어 질의 자체를 하지 않은 상태(resolvedData === null)는 실패가 아니다.
    const loadFailed = resolvedData?.loadFailed === true;

    // 2. 로컬 Override 반영
    const vehicles = serverVehicles;

    /**
     * 운행일지가 이미 있는데 '운행 중'으로 남은 내 예약 → 일지 기준으로 끝난 운행으로 본다.
     *
     * 일지는 올라갔는데 예약 완료 쓰기가 빠진 경우다(통신이 약할 때 저장 중 앱이 닫히면 생긴다).
     * 화면에 '운행 중'이 그대로 뜨면 운전자는 운행 종료를 다시 눌러 같은 운행의 일지를 두 번
     * 쓴다(2026-10-28 이용 기관 신고). 일지가 있다는 것은 운행이 끝났다는 확실한 근거다.
     */
    const loggedEndTimes = useMemo(() => {
        const map = new Map<string, string>();
        for (const log of myLogs) {
            if (log.reservationId) map.set(log.reservationId, log.endTime || '');
        }
        return map;
    }, [myLogs]);
    const applyLocalState = useCallback((list: Reservation[]) =>
        list
            .filter(r => !localCancelledIds.has(r.id))
            .map(r => localStartedIds.has(r.id) ? { ...r, status: 'in_progress' as ReservationStatus, actualStartTime: localStartedIds.get(r.id) } : r)
            .map(r => r.status === 'in_progress' && loggedEndTimes.has(r.id) ? { ...r, status: 'completed' as ReservationStatus } : r)
    , [localCancelledIds, localStartedIds, loggedEndTimes]);

    const todayReservations = useMemo(() => applyLocalState(serverToday), [serverToday, applyLocalState]);
    const weekReservations = useMemo(() => applyLocalState(serverWeek), [serverWeek, applyLocalState]);

    // 위에서 끝난 운행으로 본 예약은 서버에도 완료로 고쳐 둔다 — 화면만 고치면 차량이 계속
    // 점유된 것으로 보이고 미작성 알림이 울린다. 소유자 본인의 in_progress → completed라 규칙이 허용한다.
    const healedIds = useRef(new Set<string>());
    useEffect(() => {
        if (!user?.uid) return;
        for (const r of serverWeek) {
            if (r.reservedByUid !== user.uid || r.status !== 'in_progress') continue;
            if (!loggedEndTimes.has(r.id) || healedIds.current.has(r.id)) continue;
            healedIds.current.add(r.id);
            updateReservationStatus(r.id, 'completed', {
                actualEndTime: loggedEndTimes.get(r.id) || r.endTime,
            }).catch(err => captureError(err, { context: 'useTodayDashboard.healLoggedReservation', reservationId: r.id }));
        }
    }, [serverWeek, loggedEndTimes, user]);

    // 3. 파생 상태 연산
    const incompleteAlerts = useMemo(() => {
        if (!user?.uid) return [];
        const logReservationIds = new Set(myLogs.filter((l: DriveLog) => l.reservationId).map((l: DriveLog) => l.reservationId));
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toLocalDateStr(yesterday);

        return weekReservations
            .filter(res => res.reservedByUid === user.uid
                && (res.status === 'in_progress' || res.status === 'completed')
                && (res.date ?? '') <= yesterdayStr
                && !logReservationIds.has(res.id)
            ).map(res => ({ type: 'reservation' as const, ...res })) as (Reservation & { type: string })[];
    }, [weekReservations, myLogs, user]);

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
        [todayReservations, user]
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
    }, [weekReservations, user, todayStr]);

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
        refresh, loadFailed,
    };
}
