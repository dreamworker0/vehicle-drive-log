/**
 * resolveStartKm — 차량별 출발 Km를 결정하는 로직
 * useDriveLogForm에서 추출
 */
import { getLastVehicleEndKm, getVehicleEndKmBefore } from '../../lib/firestore';
import { todayStr } from '../utils/driveLogValidation';
import type { Vehicle } from '../../types/vehicle';

/**
 * 차량의 출발 Km를 결정한다.
 * - 과거 날짜: 해당 날짜 이전의 마지막 endKm
 * - 오늘 + 출발 시각: 해당 시각 이전의 마지막 endKm
 * - 기본: 차량 currentKm과 최근 endKm 중 큰 값
 */
export async function resolveStartKm(
    orgId: string,
    vehicleId: string,
    options: {
        driveDate?: string;
        startTime?: string;
        vehicle?: Vehicle | null;
    } = {},
): Promise<string> {
    const { driveDate, startTime, vehicle } = options;
    const fallbackKm = vehicle?.currentKm ?? '';

    if (driveDate && driveDate !== todayStr()) {
        // 과거 날짜: 해당 날짜 이전의 마지막 endKm
        const [y, m, d] = driveDate.split('-').map(Number);
        const beforeDate = new Date(y, m - 1, d);
        const fetchedKm = await getVehicleEndKmBefore(orgId, vehicleId, beforeDate);
        return fetchedKm !== null ? fetchedKm.toString() : (fallbackKm ?? '').toString();
    }

    if (driveDate && startTime) {
        // 오늘 + 출발 시각: 해당 시각 이전의 마지막 endKm
        const [y, m, d] = driveDate.split('-').map(Number);
        const [h, min] = startTime.split(':').map(Number);
        const beforeTime = new Date(y, m - 1, d, h, min);
        const fetchedKm = await getVehicleEndKmBefore(orgId, vehicleId, beforeTime);
        return fetchedKm !== null ? fetchedKm.toString() : (fallbackKm ?? '').toString();
    }

    // 기본: 차량 currentKm과 최근 endKm 중 큰 값
    const lastEndKm = await getLastVehicleEndKm(orgId, vehicleId);
    const k1 = Number(fallbackKm || 0);
    const k2 = Number(lastEndKm || 0);
    return (Math.max(k1, k2) || '').toString();
}
