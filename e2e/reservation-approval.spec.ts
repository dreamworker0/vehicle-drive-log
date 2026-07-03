/**
 * 예약 승인/반려 워크플로우 E2E.
 *
 * [2026-07-04] 승인/반려 여정은 authed-reservationApproval.spec.ts(에뮬레이터 인증 E2E)로
 * 이관·구현되었다. 관리자가 승인 대기 예약을 승인/반려하는 UI 동작을 실제 로그인 세션으로 검증한다.
 *
 * (예약 "생성"은 createReservationSafe 콜러블 경유라 functions 에뮬레이터가 없는 현 E2E 환경에서
 *  UI로 재현할 수 없으며, 서버 생성 로직은 functions/src/__tests__/createReservationSafe.test.ts가 커버한다.)
 */
export {};
