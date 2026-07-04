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

/**
 * 차량이 해당 사용자에게 사용 제한된 상태인지 판별한다.
 * - allowedUserIds가 없거나 빈 배열이면 전체 허용 (기존 차량 하위 호환)
 * - 목록이 있으면 역할(admin 포함)과 무관하게 목록에 포함된 사용자만 허용
 * @param vehicle allowedUserIds 필드를 가진 차량
 * @param uid 현재 사용자 uid
 * @returns true면 이 사용자에게 제한된 차량
 */
export function isVehicleRestrictedForUser(
    vehicle: Pick<Vehicle, 'allowedUserIds'>,
    uid: string | null | undefined
): boolean {
    const allowed = vehicle.allowedUserIds;
    if (!allowed || allowed.length === 0) return false;
    return !uid || !allowed.includes(uid);
}
