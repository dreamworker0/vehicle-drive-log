import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { getMyDriveLogs } from '../lib/firestore';

/**
 * useVehiclePriority — 사용자 운행 빈도 기반 차량 우선순위
 * 사용 컴포넌트: VehicleSelector (QuickDriveStart, DriveLogForm, FuelLogTab 경유)
 *
 * 최근 운행 기록에서 vehicleId별 사용 횟수를 집계하여
 * VehicleSelector의 정렬 기준으로 사용한다.
 */
export default function useVehiclePriority() {
    const { user, userData } = useAuth();
    const orgId = userData?.organizationId;
    const uid = user?.uid;

    const [usageCounts, setUsageCounts] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (!orgId || !uid) return;

        const load = async () => {
            try {
                // 최근 운행 기록 가져오기 (기본 30건)
                const logs = await getMyDriveLogs(orgId, uid, 100);
                const counts = new Map<string, number>();
                for (const log of logs) {
                    if (log.vehicleId) {
                        counts.set(log.vehicleId, (counts.get(log.vehicleId) || 0) + 1);
                    }
                }
                setUsageCounts(counts);
            } catch (err) {
                console.error('차량 사용 빈도 조회 실패:', err);
            }
        };
        load();
    }, [orgId, uid]);

    return { usageCounts };
}
