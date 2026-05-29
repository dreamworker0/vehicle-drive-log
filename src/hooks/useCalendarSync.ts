import { useState, useCallback } from 'react';
import { firebaseFunctions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

const STORAGE_KEY = 'last_calendar_sync_time_map';
const COOLDOWN_MS = 30 * 60 * 1000; // 30분

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
            console.log(`[useCalendarSync] Vehicle ${vehicleId} is on cooldown. Skip on-demand sync.`);
            return false;
        }

        setLoading(true);
        setError(null);

        const callable = httpsCallable<{ vehicleId: string; organizationId: string }, { success: boolean }>(
            firebaseFunctions,
            'triggerOnDemandCalendarSync'
        );

        let attempt = 0;
        const maxAttempts = 3;
        const baseDelay = 2000; // 2s -> 4s -> 8s

        while (attempt < maxAttempts) {
            try {
                console.log(`[useCalendarSync] Attempt ${attempt + 1} to sync vehicle ${vehicleId}`);
                const response = await callable({ vehicleId, organizationId });
                
                if (response.data && response.data.success) {
                    updateSyncTime(vehicleId);
                    setLoading(false);
                    console.log(`[useCalendarSync] Success syncing vehicle ${vehicleId}`);
                    return true;
                }
                
                throw new Error('On-demand calendar sync failed without success status.');
            } catch (err) {
                attempt++;
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn(`[useCalendarSync] Sync attempt ${attempt} failed:`, errMsg);
                
                if (attempt >= maxAttempts) {
                    setError(errMsg);
                    setLoading(false);
                    return false;
                }
                
                const backoffDelay = baseDelay * Math.pow(2, attempt - 1); // 2000ms -> 4000ms -> 8000ms
                console.log(`[useCalendarSync] Waiting ${backoffDelay}ms before retry...`);
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
