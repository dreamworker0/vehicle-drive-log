// D13 규칙 준수: index.ts에는 export와 전역 설정 로드만 남깁니다.
// Firebase Admin 및 전역 옵션 초기화
import "./core/firebase";
// Sentry 에러 모니터링 초기화
import "./core/sentry";

// OCR Functions
export { ocrDashboard } from "./handlers/callable/ocrDashboard";
export { ocrDocument } from "./handlers/callable/ocrDocument";
export { autoVerifyDocument } from "./handlers/triggers/autoVerifyDocument";

// 기관 증빙서류 단기 서명 URL 발급 (심사 화면 표시용, superAdmin 전용)
export { getOrgDocumentUrl } from "./handlers/callable/getOrgDocumentUrl";

// Holiday Proxy
export { holidayProxy } from "./handlers/https/holidayProxy";

// Tmap Proxy (프로덕션 CORS 해결)
export { tmapProxy } from "./handlers/https/tmapProxy";

// 야간 통계 집계 (기관 월간 집계 + 대시보드 통계 캐시, 매일 02:00)
export { nightlyStatsBatch } from "./handlers/scheduled/nightlyStatsBatch";

// 야간 배치 (Firestore 백업 + 차량 보험 만료 알림, 매일 02:20)
export { dailyNightlyBatch } from "./handlers/scheduled/dailyNightlyBatch";

// 주간 유지보수 (기관 퍼지 + 증빙 이미지 정리 + 운행기록 아카이빙, 매주 일 03:00)
export { weeklyMaintenanceBatch } from "./handlers/scheduled/weeklyMaintenanceBatch";

// 통합 월배치 (공휴일 동기화 + 마일리지 검증, 매월 1일 06:00)
export { monthlyBatch } from "./handlers/scheduled/monthlyBatch";

// Admin Notice
export { sendAdminNotice } from "./handlers/callable/sendAdminNotice";

// 전체 기관 일괄 공지 (superAdmin 전용)
export { sendBroadcastNotice } from "./handlers/callable/sendBroadcastNotice";

// 예약 생성 (중복 방지 — Firestore Transaction)
export { createReservationSafe } from "./handlers/callable/createReservationSafe";

// 기관 신청 이메일 알림
export { notifyNewApplication } from "./handlers/triggers/notifyNewApplication";

// 기관 승인 이메일 발송 (서버사이드)
export { sendApprovalEmail } from "./handlers/callable/sendApprovalEmail";

// 기관 거절 이메일 발송 (서버사이드)
export { sendRejectionEmail } from "./handlers/callable/sendRejectionEmail";

// 수동 승인 시 알림톡 발송
export { sendManualApprovalAlimtalk } from "./handlers/callable/sendManualApprovalAlimtalk";

// 수동 반려 시 알림톡 발송
export { sendManualRejectionAlimtalk } from "./handlers/callable/sendManualRejectionAlimtalk";

// Reservation Reminder (예약 알림 + 미작성 알림)
export { reservationReminder } from "./handlers/scheduled/reservationReminderScheduler";

// 예약 트리거 (Google Calendar 연동 + 푸시 알림)
export { onReservationCreated, onReservationUpdated, onReservationDeleted } from "./handlers/triggers/reservationTriggers";

// Google Calendar -> App 역동기화 (평일 06~22시, 30분마다)
export { syncCalendarToApp } from "./handlers/scheduled/calendarSchedule";

// 운행일지 중복 정리 (관리자용)
export { cleanupDuplicateLogs } from "./handlers/callable/cleanupDuplicateLogs";

// 대시보드 성능 고도화를 위한 운행일지 집계 통계 캐싱
// 집계 통계 일괄 재계산 (마이그레이션/보정용)
export { recalculateAggregatedStats } from "./handlers/callable/recalculateAggregatedStats";

// SuperAdmin 대시보드 통계 수동 갱신
export { refreshDashboardStats } from "./handlers/callable/refreshDashboardStats";

// 직원 삭제 (Auth 비활성화 + Firestore 삭제)
export { disableUser } from "./handlers/callable/disableUser";

// 계정 복원 (Auth 재활성화 + Firestore 재생성)
export { restoreUser } from "./handlers/callable/restoreUser";

// 비활성 직원 완전 삭제 (users 문서 + 즐겨찾기 + Auth 계정 영구 삭제, 운행 기록은 보존)
export { deleteUserPermanently } from "./handlers/callable/deleteUserPermanently";

// 기관 자발적 서비스 해지 (관리자가 사유와 함께 직접 탈퇴)
export { withdrawOrganization } from "./handlers/callable/withdrawOrganization";

// Custom Claims 자동 동기화 (users 문서 변경 → Auth Claims 설정)
export { setCustomClaims } from "./handlers/triggers/setCustomClaims";

// 초대 코드로 기관 가입 (신규 사용자 Custom Claims 미보유 대응)
export { joinOrganization } from "./handlers/callable/joinOrganization";
// 초대 코드 재발급 — Rules가 기관관리자의 inviteCode 쓰기를 닫아 서버 난수·중복 검사로만 발급한다
export { regenerateInviteCode } from "./handlers/callable/regenerateInviteCode";
export { acceptCurrentTerms } from "./handlers/callable/acceptCurrentTerms";
export { recordSession } from "./handlers/callable/recordSession";
export { recordExport } from "./handlers/callable/recordExport";

// 첫 직원 등록 시점 추적
export { trackFirstEmployee } from "./handlers/triggers/trackFirstEmployee";

// 기존 기관 좌표 마이그레이션 (일회성)
export { backfillOrgCoords } from "./handlers/callable/backfillOrgCoords";

// 월별 집계(orgStats/monthly) 소급 재집계 (일회성 백필, superAdmin 호출)
export { backfillMonthlyStats } from "./handlers/callable/backfillMonthlyStats";

// 피드백 AI 답변 초안 생성 (의견 등록 시 자동 실행)
export { generateFeedbackDraft } from "./handlers/triggers/generateFeedbackDraft";

// 피드백 AI 답변 수동 재생성 (관리자 호출)
export { regenerateFeedbackDraft } from "./handlers/callable/regenerateFeedbackDraft";

// 피드백 답변 발송 (슈퍼관리자 → 사용자 알림)
export { sendFeedbackReply } from "./handlers/callable/sendFeedbackReply";

// AI에게 물어보기 (FAQ 기반 Gemini 답변)
export { askAI } from "./handlers/callable/askAI";

// 슈퍼관리자 API 헬스 체크
export { apiHealthCheck } from "./handlers/https/apiHealthCheck";

// 캘린더 동기화 실패 카운터 리셋 (슈퍼관리자용)
export { resetCalendarSyncFails } from "./scripts/resetCalendarSyncFails";

// 연동 캘린더 일괄 접근 진단 — 리셋 전에 무엇이 살아 있는지 가른다 (슈퍼관리자용·읽기 전용)
export { probeCalendarAccess } from "./handlers/callable/probeCalendarAccess";

// 캘린더 접근 테스트 (관리자용)
export { testCalendarAccess } from "./handlers/callable/testCalendarAccess";

// 미활성 기관 일괄 알림톡 발송
export { sendBulkReminder } from "./handlers/callable/sendBulkReminder";

// 미활성 기관 발송 스케줄러 (매주 월~금 14시 점검, 주 1회 발송)
export { sendInactiveOrgAlimtalkScheduled } from "./handlers/scheduled/sendInactiveOrgAlimtalkScheduled";

// 사용자 권한 변경 탐지 (보안 알림)
export { notifyRoleChange } from "./handlers/triggers/notifyRoleChange";

// 익명 로그인 대체용 기관 신청 API
export { submitOrgApplication } from "./handlers/https/submitOrgApplication";

// 랜딩 페이지 비번/기관 미로그인 유저의 문의 접수용 API
export { submitPublicFeedback } from "./handlers/https/submitPublicFeedback";

// 회원 탈퇴 시 개인정보 익명화 트리거
export { onUserDelete } from "./handlers/triggers/onUserDelete";

// 운행일지 생성/수정/삭제 시 차량 주행거리 증분 및 자동 연쇄 동기화
export { onDriveLogCreated, onDriveLogUpdated, onDriveLogDeleted } from "./handlers/triggers/syncDriveLogKm";

// 주유일지가 작성되면 그 차량의 "주유 필요" 표시를 끈다 (켜는 쪽은 위 운행일지 트리거)
export { onFuelLogCreated } from "./handlers/triggers/clearRefuelFlag";

// 접속기록/변경 로그 (고시 「개인정보의 안전성 확보조치 기준」 제16조)
export {
    auditDriveLogCreated, auditDriveLogUpdated, auditDriveLogDeleted,
    auditUserCreated, auditUserUpdated, auditUserDeleted,
} from "./handlers/triggers/auditLog";

// 구글 캘린더 온디맨드 동기화 API
export { triggerOnDemandCalendarSync } from "./handlers/callable/triggerOnDemandCalendarSync";

// Slack 어시스턴트 — 이벤트 수신 (서명 검증 + task 큐잉, 3초 ack)
export { slackEvents } from "./handlers/https/slackEvents";

// Slack 어시스턴트 — 워커 (자연어 파싱 → 예약 조회/생성)
export { onSlackTaskCreated } from "./handlers/triggers/onSlackTaskCreated";

// Slack 멀티테넌트 셀프서비스 — OAuth 설치 URL 발급(콜러블) + 콜백(토큰 교환·암호화 저장)
export { getSlackInstallUrl } from "./handlers/callable/getSlackInstallUrl";
export { slackOauthCallback } from "./handlers/https/slackOauthCallback";

// Slack 연결 설정 화면 — 상태 조회 / 연결 해제 / 직원 준비 상태 진단
export { getSlackConnectionStatus } from "./handlers/callable/getSlackConnectionStatus";
export { disconnectSlack } from "./handlers/callable/disconnectSlack";
export { diagnoseSlackConnection } from "./handlers/callable/diagnoseSlackConnection";

// Slack 전체 연결 기관 현황 (슈퍼관리자 대시보드)
export { listSlackIntegrations } from "./handlers/callable/listSlackIntegrations";
