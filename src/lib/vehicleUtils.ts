/**
 * vehicleUtils — 차량 상태 관련 유틸리티 함수
 */
import type { Vehicle, VehicleMaintenance } from '../types/vehicle';
import { toLocalDateStr } from './dateUtils';

/**
 * 차량이 현재 정비 차단 상태인지 판별한다.
 * - isBlocked가 true여야 함
 * - endDate가 설정된 경우, 오늘이 endDate를 초과하면 차단 해제로 간주
 *   (endDate는 "마지막 차단일"로, endDate 당일까지 차단)
 * @param maintenance 차량의 maintenance 필드
 * @returns true면 현재 차단 중
 */
export function isVehicleBlocked(maintenance: VehicleMaintenance | null | undefined): boolean {
    if (!maintenance?.isBlocked) return false;
    // endDate가 없으면 무기한 차단 (수동 해제 필요)
    if (!maintenance.endDate) return true;
    // endDate 당일까지 차단, 그 다음 날부터 자동 해제
    const today = toLocalDateStr();
    return today <= maintenance.endDate;
}
