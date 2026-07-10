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
        const map = getSyncTimeMap();
        const lastSync = map[vehicleId];
        if (!lastSync) return true; // 이력이 없으면 쿨다운 해제 상태
        return Date.now() - lastSync >= COOLDOWN_MS;
    }, [getSyncTimeMap]);

    const syncVehicleOnDemand = useCallback(async (vehicleId: string, organizationId: string): Promise<boolean> => {
        // 쿨다운 상태 검증
        if (!checkCooldown(vehicleId)) {
            devLog(`[useCalendarSync] Vehicle ${vehicleId} is on cooldown. Skip on-demand sync.`);
            return false;
        }

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
    }, [checkCooldown, updateSyncTime]);

    return {
        syncVehicleOnDemand,
        checkCooldown,
        loading,
        error,
    };
}
