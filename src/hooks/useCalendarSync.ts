import { useState, useCallback } from 'react';
import { firebaseFunctions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

const STORAGE_KEY = 'last_calendar_sync_time_map';
const COOLDOWN_MS = 30 * 60 * 1000; // 30분

// 정보성 동기화 로그는 개발 모드에서만 출력 — 프로덕션 콘솔 노이즈·내부 정보 노출 방지.
// (실패는 아래 console.warn/error로 프로덕션에서도 계속 남긴다.)
const devLog = import.meta.env.DEV ? console.log.bind(console) : () => {};

interface SyncTimeMap {
    [vehicleId: string]: number;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SLOT_MS = 30 * 60 * 1000;
/** 정기 동기화 한 회차가 끝날 때까지 기다리는 여유 — 1회 소요 약 20초(2026-10 실측) */
const SLOT_SETTLE_MS = 5 * 60 * 1000;
const FIRST_SLOT_MIN = 6 * 60;       // 06:00
const LAST_SLOT_MIN = 22 * 60 + 30;  // 22:30

/**
 * 지금 화면에 보이는 예약을 맞춰 둔 **가장 최근 정기 동기화 회차**의 시각. 없으면 null.
 *
 * 서버의 `syncCalendarToApp`(functions/src/handlers/scheduled/calendarSchedule.ts)은
 * 평일 06:00~22:30(KST)에 30분마다 연동 차량 전체를 맞춘다. 그 시간에는 화면을 열 때마다
 * 부르는 온디맨드 동기화가 같은 일을 한 번 더 할 뿐이었다(2026-10 실측: 2.7만 회/월,
 * Cloud Run vCPU 사용량 1위). 그래서 정기 회차가 맡는 시간에는 자동 호출을 하지 않는다.
 * 주말·야간과 수동 "지금 동기화"(force)는 그대로 부른다.
 *
 * 회차가 막 시작된 직후(SLOT_SETTLE_MS 안)에는 아직 끝나지 않았을 수 있으니 직전 회차로 본다.
 * 그날 첫 회차가 끝나기 전(06:00~06:05)에는 전날 밤 변경분이 남아 있으므로 null이다.
 * **서버 스케줄을 바꾸면 위 상수도 함께 바꾼다.**
 */
export function lastScheduledCalendarSyncAt(now: number = Date.now()): number | null {
    const kst = new Date(now + KST_OFFSET_MS);
    const day = kst.getUTCDay(); // 0=일, 6=토
    if (day === 0 || day === 6) return null;

    const settled = now - SLOT_SETTLE_MS;
    const slotStart = settled - ((settled + KST_OFFSET_MS) % SLOT_MS);
    const slotKst = new Date(slotStart + KST_OFFSET_MS);
    // 회차가 같은 날이어야 한다 — 자정 직후에 전날 22:30 회차로 거슬러 가지 않게
    if (slotKst.getUTCDate() !== kst.getUTCDate()) return null;
    const slotMin = slotKst.getUTCHours() * 60 + slotKst.getUTCMinutes();
    if (slotMin < FIRST_SLOT_MIN || slotMin > LAST_SLOT_MIN) return null;
    // 마지막 회차(22:30)도 다른 회차와 같은 길이(다음 회차 자리 + 여유, 23:05)까지만 유효하다
    if (now - slotStart >= SLOT_MS + SLOT_SETTLE_MS) return null;
    return slotStart;
}

/**
 * 진행 중인 차량별 동기화 — 화면 두 곳(홈·예약 캘린더)과 effect 재실행이 같은 차량을 겹쳐
 * 부르지 않게 모듈 수준에서 공유한다. 쿨다운은 끝난 뒤에야 기록되므로 그 사이의 중복은
 * 쿨다운으로 막을 수 없다(JAVASCRIPT-REACT-6E "Consecutive HTTP").
 */
const inFlight = new Map<string, Promise<boolean>>();

export function useCalendarSync() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getSyncTimeMap = useCallback((): SyncTimeMap => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }, []);

    const updateSyncTime = useCallback((vehicleId: string) => {
        try {
            const map = getSyncTimeMap();
            map[vehicleId] = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        } catch (err) {
            console.error('Failed to save calendar sync timestamp:', err);
        }
    }, [getSyncTimeMap]);

    const checkCooldown = useCallback((vehicleId: string): boolean => {
        // 정기 동기화가 맡는 시간이면 자동 호출하지 않는다 (lastScheduledCalendarSyncAt 참고)
        if (lastScheduledCalendarSyncAt() !== null) return false;
        const map = getSyncTimeMap();
        const lastSync = map[vehicleId];
        if (!lastSync) return true; // 이력이 없으면 쿨다운 해제 상태
        return Date.now() - lastSync >= COOLDOWN_MS;
    }, [getSyncTimeMap]);

    // 마지막 동기화 시각 조회 — 대상 차량들 중 가장 최근 성공 시각 (없으면 null)
    // 정기 회차도 넣는다 — 그 시간에는 자동 호출을 하지 않으므로 빼면 표시가 낡은 채로 남는다.
    const getLastSyncTime = useCallback((vehicleIds: string[]): number | null => {
        const map = getSyncTimeMap();
        const scheduled = vehicleIds.length > 0 ? lastScheduledCalendarSyncAt() : null;
        const times = [...vehicleIds.map((id) => map[id]), scheduled]
            .filter((t): t is number => typeof t === 'number');
        return times.length > 0 ? Math.max(...times) : null;
    }, [getSyncTimeMap]);

    /** 실제 호출 + 백오프 재시도 — 쿨다운·중복 판정은 syncVehicleOnDemand가 맡는다 */
    const runSync = useCallback(async (vehicleId: string, organizationId: string): Promise<boolean> => {
        setLoading(true);
        setError(null);

        const callable = httpsCallable<
            { vehicleId: string; organizationId: string },
            { success: boolean; errorType?: string; message?: string }
        >(
            firebaseFunctions,
            'triggerOnDemandCalendarSync'
        );

        let attempt = 0;
        const maxAttempts = 3;
        const baseDelay = 2000; // 2s -> 4s -> 8s

        while (attempt < maxAttempts) {
            try {
                devLog(`[useCalendarSync] Attempt ${attempt + 1} to sync vehicle ${vehicleId}`);
                const response = await callable({ vehicleId, organizationId });
                
                if (response.data && response.data.success) {
                    updateSyncTime(vehicleId);
                    setLoading(false);
                    devLog(`[useCalendarSync] Success syncing vehicle ${vehicleId}`);
                    return true;
                }

                // 서버가 호출 빈도 상한으로 건너뛴 경우 — 재시도하면 상한을 더 소모할 뿐이다.
                // 쿨다운을 적용해 조용히 멈춘다. 놓친 변경은 30분 주기 스케줄러가 따라잡는다.
                if (response.data && response.data.errorType === 'rate-limited') {
                    devLog(`[useCalendarSync] Server rate limit hit for vehicle ${vehicleId}. Stopping retries.`);
                    updateSyncTime(vehicleId);
                    setLoading(false);
                    return false;
                }

                // 캘린더 미존재/공유 권한 누락은 설정 오류이므로 재시도 무의미 → 쿨다운 적용 후 조용히 중단
                if (response.data && response.data.errorType === 'calendar-not-found') {
                    devLog(`[useCalendarSync] Calendar not found or unlinked for vehicle ${vehicleId}. Stopping retries.`);
                    updateSyncTime(vehicleId);
                    setError(response.data.message || 'calendar-not-found');
                    setLoading(false);
                    return false;
                }

                throw new Error('On-demand calendar sync failed without success status.');
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn(`[useCalendarSync] Sync attempt ${attempt + 1} failed:`, errMsg);

                // 캘린더를 찾을 수 없는 경우 무의미한 재시도를 중단하고 쿨다운 적용
                if (errMsg.includes('Not Found') || errMsg.includes('찾을 수 없습니다') || errMsg.includes('not-found')) {
                    devLog(`[useCalendarSync] Calendar not found or unlinked for vehicle ${vehicleId}. Stopping retries.`);
                    updateSyncTime(vehicleId); // 쿨다운 적용하여 당분간 재시도 방지
                    setError(errMsg);
                    setLoading(false);
                    return false;
                }

                attempt++;
                if (attempt >= maxAttempts) {
                    // 재시도까지 다 실패해도 쿨다운을 건다. 안 걸면 화면을 열 때마다 3회씩 다시
                    // 부른다(6E). 놓친 변경은 30분 주기 스케줄러가 따라잡는다.
                    updateSyncTime(vehicleId);
                    setError(errMsg);
                    setLoading(false);
                    return false;
                }
                
                const backoffDelay = baseDelay * Math.pow(2, attempt - 1); // 2000ms -> 4000ms -> 8000ms
                devLog(`[useCalendarSync] Waiting ${backoffDelay}ms before retry...`);
                await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            }
        }

        setLoading(false);
        return false;
    }, [updateSyncTime]);

    const syncVehicleOnDemand = useCallback(async (vehicleId: string, organizationId: string, options?: { force?: boolean }): Promise<boolean> => {
        // 쿨다운 상태 검증 (수동 "지금 동기화"는 force로 우회)
        if (!options?.force && !checkCooldown(vehicleId)) {
            devLog(`[useCalendarSync] Vehicle ${vehicleId} is on cooldown. Skip on-demand sync.`);
            return false;
        }
        // 같은 차량을 이미 동기화 중이면 그 결과를 함께 기다린다 — force여도 같은 요청을 두 번 보낼 이유는 없다
        const running = inFlight.get(vehicleId);
        if (running) return running;

        const task = runSync(vehicleId, organizationId);
        inFlight.set(vehicleId, task);
        try {
            return await task;
        } finally {
            inFlight.delete(vehicleId);
        }
    }, [checkCooldown, runSync]);

    return {
        syncVehicleOnDemand,
        checkCooldown,
        getLastSyncTime,
        loading,
        error,
    };
}
