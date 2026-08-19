/**
 * 차량 상태 판정 — shared/vehicleStatus.ts에서 re-export
 * 예약 화면(프론트엔드)·Slack 어시스턴트·예약 생성 트랜잭션이 같은 규칙을 쓴다.
 */
export { isVehicleBlockedOn, isVehicleRetired } from "../../../shared/vehicleStatus";
export type { MaintenanceLike, RetiredLike } from "../../../shared/vehicleStatus";

/** Asia/Seoul 기준 오늘(YYYY-MM-DD) — 서버는 UTC로 돌기 때문에 반드시 시간대를 지정한다. */
export function seoulTodayStr(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
