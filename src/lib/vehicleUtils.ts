/**
 * vehicleUtils — 차량 상태 관련 유틸리티 함수
 */
import type { Vehicle, VehicleMaintenance } from '../types/vehicle';
import { toLocalDateStr } from './dateUtils';
import { isVehicleBlockedOn } from '../../shared/vehicleStatus';

export { isVehicleRetired } from '../../shared/vehicleStatus';

/**
 * 차량이 **오늘** 정비 차단 상태인지 판별한다.
 *
 * 판정 규칙 자체는 shared/vehicleStatus.ts에 있다 — 예약 생성 트랜잭션과 Slack 어시스턴트가
 * 같은 규칙을 써야 화면에서 막힌 차량이 다른 경로로 예약되는 일이 없다.
 * 여기서는 브라우저 로컬 기준의 '오늘'만 주입한다.
 *
 * @param maintenance 차량의 maintenance 필드
 * @returns true면 현재 차단 중
 */
export function isVehicleBlocked(maintenance: VehicleMaintenance | null | undefined): boolean {
    return isVehicleBlockedOn(maintenance, toLocalDateStr());
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
