#!/usr/bin/env tsx
/**
 * generate-functions-doc.ts
 *
 * Cloud Functions 레퍼런스 마크다운 자동 생성 스크립트
 *
 * 사용법:
 *   npx tsx scripts/generate-functions-doc.ts
 *
 * 출력: docs/FUNCTIONS_REFERENCE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'docs', 'FUNCTIONS_REFERENCE.md');

// ── 함수 카탈로그 (수동 관리 — 함수 추가 시 여기에도 추가) ──
// 정합성 확인: functions/src/index.ts의 export 목록과 이 배열의 name이 1:1이어야 한다.
interface FunctionEntry {
  name: string;
  type: 'onCall' | 'onRequest' | 'onSchedule' | 'onDocumentCreated' | 'onDocumentWritten' | 'onDocumentUpdated' | 'onDocumentDeleted' | 'onUserDeleted';
  file: string;
  description: string;
  auth: string;
  params?: string;
  returns?: string;
  note?: string;
}

const FUNCTIONS: FunctionEntry[] = [
  // ── OCR ──
  {
    name: 'ocrDashboard',
    type: 'onCall',
    file: 'handlers/callable/ocrDashboard.ts',
    description: '계기판 사진을 Gemini Vision API로 분석하여 현재 주행거리(km)와 배터리%(EV) 추출',
    auth: '기관 멤버 (인증 필수)',
    params: '{ imageBase64: string, mimeType: string }',
    returns: '{ km: number | null, batteryPercent: number | null }',
  },
  {
    name: 'ocrDocument',
    type: 'onCall',
    file: 'handlers/callable/ocrDocument.ts',
    description: '사업자등록증/고유번호증 이미지를 OCR하여 기관명, 사업자번호, 주소 추출',
    auth: '인증 필수',
    params: '{ imageBase64: string, mimeType: string }',
    returns: '{ orgName: string, bizNumber: string, address: string }',
  },
  {
    name: 'getOrgDocumentUrl',
    type: 'onCall',
    file: 'handlers/callable/getOrgDocumentUrl.ts',
    description: '기관 증빙서류의 5분 만료 서명 URL 발급 (심사 화면 표시용). 증빙서류는 영구 다운로드 토큰 없이 경로만 저장되므로 표시 시점마다 온디맨드 발급한다.',
    auth: 'superAdmin 전용',
    params: '{ orgId: string }',
    returns: '{ url: string }',
  },

  // ── 예약 ──
  {
    name: 'createReservationSafe',
    type: 'onCall',
    file: 'handlers/callable/createReservationSafe.ts',
    description: 'Firestore Transaction으로 예약 중복을 방지하며 안전하게 예약 생성',
    auth: '인증된 기관 멤버',
    params: '{ organizationId, vehicleId, vehicleName, date, startTime, endTime, purpose, destination, reservedByUid, reservedByName }',
    returns: '{ success: boolean, reservationId: string }',
  },
  {
    name: 'triggerOnDemandCalendarSync',
    type: 'onCall',
    file: 'handlers/callable/triggerOnDemandCalendarSync.ts',
    description: '예약 화면 진입 시 해당 차량만 구글 캘린더 역동기화 (30분 스케줄을 기다리지 않고 즉시 반영)',
    auth: '인증된 기관 멤버',
    params: '{ vehicleId?: string, organizationId?: string }',
    note: '동기화 실패가 누적된 차량(MAX_FAIL_COUNT 초과)은 스킵',
  },
  {
    name: 'testCalendarAccess',
    type: 'onCall',
    file: 'handlers/callable/testCalendarAccess.ts',
    description: 'Google Calendar API 접근 가능 여부 테스트 (관리자 진단용)',
    auth: '기관 관리자 이상',
  },
  {
    name: 'resetCalendarSyncFails',
    type: 'onCall',
    file: 'scripts/resetCalendarSyncFails.ts',
    description: '캘린더 동기화 실패 카운터 초기화',
    auth: 'superAdmin',
  },

  // ── 사용자·기관 ──
  {
    name: 'joinOrganization',
    type: 'onCall',
    file: 'handlers/callable/joinOrganization.ts',
    description: '초대 코드로 기관에 가입. 신규 사용자가 Custom Claims 미보유 시에도 정상 처리. 이용약관 동의를 함께 기록한다(개인정보 동의는 받지 않음 — 처리 근거가 기관의 업무 수행이므로). `termsVersion`은 `YYYY-MM-DD` 형식.',
    auth: '인증 필수 (익명 로그인 차단)',
    params: '{ code: string, agreedTerms: true, termsVersion: string }',
    // 표 셀 안의 파이프는 백틱으로 감싸도 셀이 쪼개지므로 이스케이프한다.
    returns: "{ success: boolean, orgId: string, orgName: string, role: 'admin' \\| 'employee' }",
  },
  {
    name: 'acceptCurrentTerms',
    type: 'onCall',
    file: 'handlers/callable/acceptCurrentTerms.ts',
    description: '개정 약관·처리방침 재동의 기록. 동의 기록은 Rules가 클라이언트 쓰기를 차단하므로 이 함수만 기록한다. 기관 관리자는 기관 위탁 동의(`organizations.consent`)와 본인 약관 동의(`users.consent`)를 함께, 직원은 본인 약관 동의만 기록. 관리자는 `agreedPrivacy`·`privacyVersion`이 필수.',
    auth: '인증 필수',
    params: '{ agreedTerms: true, termsVersion: string, agreedPrivacy?: true, privacyVersion?: string }',
    returns: '{ success: boolean, orgRecorded: boolean }',
  },
  {
    name: 'recordSession',
    type: 'onCall',
    file: 'handlers/callable/recordSession.ts',
    description: '로그인 세션 기록 — 고시 제16조의 접속지(IP)·계정·일시를 남긴다. 트리거는 IP를 볼 수 없어 콜러블로 받는다. `sessionId`는 브라우저 세션당 난수 1개이며 문서 ID에 쓰여 같은 세션의 재호출이 중복을 만들지 않는다. User-Agent는 브라우저/OS 수준으로 축약해 저장한다.',
    auth: '인증 필수',
    params: '{ sessionId: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'recordExport',
    type: 'onCall',
    file: 'handlers/callable/recordExport.ts',
    description: '개인정보 반출(엑셀·PDF 내보내기) 기록 — 고시 제16조. 형식·대상·건수만 남기고 **반출된 데이터 내용과 검색 조건은 담지 않는다**. `format`·`dataset`은 화이트리스트로 제한해 임의 값 주입을 막는다. 브라우저에서 파일을 만들므로 클라이언트가 부르지 않으면 남지 않는 한계가 있다.',
    auth: '인증 필수',
    // 표 셀 안의 파이프는 백틱으로 감싸도 셀이 쪼개지므로 이스케이프한다.
    params: "{ format: 'excel' \\| 'pdf', dataset: string, recordCount: number, exportId: string }",
    returns: '{ success: boolean }',
  },
  {
    name: 'sendBroadcastNotice',
    type: 'onCall',
    file: 'handlers/callable/sendBroadcastNotice.ts',
    description: "전체 기관의 관리자·직원에게 앱 내 알림 + 푸시를 일괄 발송. `sendAdminNotice`가 자기 기관 한정이라 서비스 전역 고지(약관 개정 등) 경로가 없어 신설. `dryRun: true`면 **대상 수만 반환하고 아무것도 보내지 않는다** — 화면이 이 값을 확인시킨 뒤에만 실제 발송한다. `noticeId`로 문서 ID를 고정해 재클릭·재시도가 알림을 중복 생성하지 않는다. 비활성 계정과 기관 미소속 계정은 제외. 발송 사실은 `broadcasts/{noticeId}`에 남긴다 — 앱 내 알림 커밋 직후 `sending`으로 먼저 쓰고 푸시 결과를 `sent`로 덧쓴다(중간에 죽으면 `sending`으로 남아 「알림은 나갔고 푸시 결과만 모른다」를 뜻한다).",
    auth: '시스템 관리자(superAdmin) 전용',
    params: '{ title: string, message: string, noticeId: string, dryRun?: boolean }',
    returns: '{ success: boolean, dryRun: boolean, recipientCount: number, pushSent?: number, pushFailed?: number }',
  },
  {
    name: 'disableUser',
    type: 'onCall',
    file: 'handlers/callable/disableUser.ts',
    description: 'Firebase Auth 비활성화 + Firestore 사용자 문서 삭제 (직원 제거)',
    auth: '기관 관리자 이상 (admin/superAdmin)',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'restoreUser',
    type: 'onCall',
    file: 'handlers/callable/restoreUser.ts',
    description: '비활성화된 계정을 Auth 재활성화 + Firestore 문서 복원',
    auth: '기관 관리자 이상',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'deleteUserPermanently',
    type: 'onCall',
    file: 'handlers/callable/deleteUserPermanently.ts',
    description: '비활성(disabled) 직원의 users 문서 + 즐겨찾기 + Auth 계정을 영구 삭제. 운행일지·주유기록 등 기관 기록은 driverName이 비정규화되어 보존된다.',
    auth: '기관 관리자 (같은 기관, disabled 상태 직원만)',
    params: '{ uid: string }',
  },
  {
    name: 'withdrawOrganization',
    type: 'onCall',
    file: 'handlers/callable/withdrawOrganization.ts',
    description: '기관 자발적 서비스 해지. 소속 직원 user 문서를 일괄 삭제하고 기관을 soft delete(30일 복구 가능) 처리하며 해지 사유를 기록한다.',
    auth: '기관 관리자 (자기 기관만)',
    params: '{ organizationId: string, reason: string, reasonDetail?: string }',
  },

  // ── 알림·이메일 ──
  {
    name: 'sendAdminNotice',
    type: 'onCall',
    file: 'handlers/callable/sendAdminNotice.ts',
    description: '관리자가 기관 전체 직원에게 알림을 발송',
    auth: '기관 관리자 이상',
    params: '{ organizationId: string, title: string, message: string }',
  },
  {
    name: 'sendApprovalEmail',
    type: 'onCall',
    file: 'handlers/callable/sendApprovalEmail.ts',
    description: '기관 승인 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendRejectionEmail',
    type: 'onCall',
    file: 'handlers/callable/sendRejectionEmail.ts',
    description: '기관 거절 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendManualApprovalAlimtalk',
    type: 'onCall',
    file: 'handlers/callable/sendManualApprovalAlimtalk.ts',
    description: '수동 승인 시 신청자에게 카카오 알림톡 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendManualRejectionAlimtalk',
    type: 'onCall',
    file: 'handlers/callable/sendManualRejectionAlimtalk.ts',
    description: '기관 신청 반려 시 신청자에게 카카오 알림톡 발송 (반려 이메일과 병행 호출)',
    auth: 'superAdmin',
    params: '{ orgId: string, reason?: string }',
  },
  {
    name: 'sendBulkReminder',
    type: 'onCall',
    file: 'handlers/callable/sendBulkReminder.ts',
    description: '미활성 기관(직원 0명)에게 알림톡 일괄 발송',
    auth: 'superAdmin',
    returns: '{ sentCount, failCount, noPhoneCount, results }',
  },

  // ── 피드백·AI ──
  {
    name: 'regenerateFeedbackDraft',
    type: 'onCall',
    file: 'handlers/callable/regenerateFeedbackDraft.ts',
    description: 'AI 피드백 답변 초안 수동 재생성 (관리자 호출)',
    auth: 'superAdmin',
  },
  {
    name: 'sendFeedbackReply',
    type: 'onCall',
    file: 'handlers/callable/sendFeedbackReply.ts',
    description: '슈퍼관리자가 피드백 답변 발송. 이메일 또는 알림톡으로 사용자에게 전달.',
    auth: 'superAdmin',
    params: '{ feedbackId: string, reply: string }',
  },
  {
    name: 'askAI',
    type: 'onCall',
    file: 'handlers/callable/askAI.ts',
    description: 'FAQ·매뉴얼 기반 Gemini AI 답변 (앱 내 "AI에게 물어보기" 기능)',
    auth: '인증 필수',
    params: '{ question: string }',
    returns: '{ answer: string, faqId: string | null, confidence: number }',
  },

  // ── 통계·정리 ──
  {
    name: 'refreshDashboardStats',
    type: 'onCall',
    file: 'handlers/callable/refreshDashboardStats.ts',
    description: 'SuperAdmin 대시보드 통계 수동 갱신 (즉시 재계산)',
    auth: 'superAdmin',
    returns: '{ success: boolean }',
  },
  {
    name: 'recalculateAggregatedStats',
    type: 'onCall',
    file: 'handlers/callable/recalculateAggregatedStats.ts',
    description: '집계 통계 일괄 재계산. 마이그레이션/데이터 보정 시 사용.',
    auth: 'superAdmin',
  },
  {
    name: 'cleanupDuplicateLogs',
    type: 'onCall',
    file: 'handlers/callable/cleanupDuplicateLogs.ts',
    description: '중복된 운행일지 탐지 및 일괄 정리 (관리자용)',
    auth: '기관 관리자 이상',
  },
  {
    name: 'apiHealthCheck',
    type: 'onCall',
    file: 'handlers/https/apiHealthCheck.ts',
    description: '외부 API(Tmap, Gemini, 이메일, Discord) 및 Firestore·스케줄러 하트비트 종합 점검',
    auth: 'superAdmin',
    returns: '{ status: "ok" | "degraded", services: Record<string, boolean> }',
  },

  // ── 공개(비로그인) 엔드포인트 ──
  {
    name: 'submitOrgApplication',
    type: 'onCall',
    file: 'handlers/https/submitOrgApplication.ts',
    description: '익명(비로그인) 사용자가 기관 신청서를 제출하는 엔드포인트. 저장 전에 증빙서류를 판별해(프리스크린) 비영리 증빙이 아니면 접수하지 않는다',
    auth: '없음 (공개 — App Check 보호)',
  },
  {
    name: 'submitPublicFeedback',
    type: 'onCall',
    file: 'handlers/https/submitPublicFeedback.ts',
    description: '랜딩 페이지 비로그인 방문자 문의 접수',
    auth: '없음 (공개 — App Check 보호)',
  },

  // ── 일회성 마이그레이션 ──
  {
    name: 'backfillOrgCoords',
    type: 'onCall',
    file: 'handlers/callable/backfillOrgCoords.ts',
    description: '기존 기관에 좌표(lat/lng) 추가 (일회성 마이그레이션)',
    auth: 'superAdmin',
  },
  {
    name: 'backfillMonthlyStats',
    type: 'onCall',
    file: 'handlers/callable/backfillMonthlyStats.ts',
    description: '월별 집계(orgStats/{orgId}/monthly) 소급 재집계. 야간 배치는 당월+전월만 갱신하므로 집계 로직 변경 후 과거 월을 교정할 때 1회 호출한다.',
    auth: 'superAdmin',
    params: '{ months?: number }',
    note: 'set(merge)라 멱등 — 타임아웃 시 재호출해도 안전',
  },

  // ── Slack 연동 (멀티테넌트 셀프서비스) ──
  {
    name: 'getSlackInstallUrl',
    type: 'onCall',
    file: 'handlers/callable/getSlackInstallUrl.ts',
    description: 'Slack 설치(OAuth) URL 발급. organizationId를 request.data가 아니라 인증 토큰의 orgId 클레임에서 가져와 브라우저 조작을 막고, 서명된 state + 1회성 nonce를 발급한다.',
    auth: '기관 관리자',
    returns: '{ url: string }',
  },
  {
    name: 'getSlackConnectionStatus',
    type: 'onCall',
    file: 'handlers/callable/getSlackConnectionStatus.ts',
    description: '기관의 Slack 연결 상태 조회 (설정 화면용). integrations 문서는 Rules로 클라이언트 접근이 차단돼 있어 이 콜러블이 안전 필드만 반환한다.',
    auth: '기관 관리자 이상',
    note: '토큰·암호문은 반환하지 않음',
  },
  {
    name: 'disconnectSlack',
    type: 'onCall',
    file: 'handlers/callable/disconnectSlack.ts',
    description: 'Slack 연결 해제. Slack 측 토큰 무효화(auth.revoke)를 베스트에포트로 시도한 뒤 암호화 토큰을 삭제하고 enabled:false / revoked:true로 표시한다.',
    auth: '기관 관리자 이상',
  },
  {
    name: 'diagnoseSlackConnection',
    type: 'onCall',
    file: 'handlers/callable/diagnoseSlackConnection.ts',
    description: 'Slack 워크스페이스 사용자 이메일과 기관 직원 이메일을 대조해 누가 봇을 쓸 준비가 됐는지 리포트. 토큰이 실제 동작해야 응답이 오므로 "연결 테스트"를 겸한다.',
    auth: '기관 관리자 이상',
  },
  {
    name: 'listSlackIntegrations',
    type: 'onCall',
    file: 'handlers/callable/listSlackIntegrations.ts',
    description: '전체 Slack 연결 기관 현황 (슈퍼관리자 대시보드용)',
    auth: 'superAdmin',
    note: '토큰·암호문 제외한 안전 필드만 반환',
  },

  // ── 프록시 (onRequest) ──
  {
    name: 'tmapProxy',
    type: 'onRequest',
    file: 'handlers/https/tmapProxy.ts',
    description: '클라이언트에서 Tmap API를 CORS 없이 호출하기 위한 서버사이드 프록시',
    auth: 'Firebase Auth 토큰 필수 + IP Rate Limit (Remote Config로 실시간 조정)',
    params: 'query params: endpoint, keyword 등 (Tmap API 파라미터)',
  },
  {
    name: 'holidayProxy',
    type: 'onRequest',
    file: 'handlers/https/holidayProxy.ts',
    description: '공공데이터포털 공휴일 API 프록시. API 키를 서버에서 관리.',
    auth: 'Firebase Auth 토큰 필수 + IP Rate Limit',
    params: 'query params: solYear, numOfRows',
  },

  // ── Slack 수신 엔드포인트 (onRequest) ──
  {
    name: 'slackEvents',
    type: 'onRequest',
    file: 'handlers/https/slackEvents.ts',
    description: 'Slack Events API + Interactivity 수신. 3초 ack 제한 때문에 서명 검증과 slackTasks 문서 생성만 하고 즉시 200을 반환한다 (실제 처리는 onSlackTaskCreated).',
    auth: 'Slack 서명 검증 (x-slack-signature)',
    note: 'task 문서 ID를 event_id로 고정해 재시도에 멱등',
  },
  {
    name: 'slackOauthCallback',
    type: 'onRequest',
    file: 'handlers/https/slackOauthCallback.ts',
    description: 'Slack 설치 OAuth 콜백. state 검증 → nonce 1회 소비(트랜잭션) → code를 봇 토큰으로 교환 → 암호화 저장 → 앱으로 302 리다이렉트.',
    auth: '서명된 state + 1회성 nonce 검증',
    note: '이미 다른 기관에 연결된 워크스페이스는 거부(중복 바인딩 방지). 토큰은 렌더·로깅하지 않음',
  },

  // ── 스케줄러 ──
  {
    name: 'reservationReminder',
    type: 'onSchedule',
    file: 'handlers/scheduled/reservationReminderScheduler.ts',
    description: '예약 임박 알림 및 미작성 운행일지 알림 발송. 같은 cron에 편승해 OCR 함수 워밍업도 수행한다.',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 8-18 * * 1-5" (Asia/Seoul) — 평일 08~18시 매시 정각, 주말 스킵',
  },
  {
    name: 'syncCalendarToApp',
    type: 'onSchedule',
    file: 'handlers/scheduled/calendarSchedule.ts',
    description: 'Google Calendar → App 역방향 동기화. 외부에서 캘린더 이벤트 변경 시 App DB에 반영.',
    auth: '시스템 자동 실행',
    note: 'schedule: "0,30 6-22 * * 1-5" — 평일 06~22시 30분 주기, 실패 누적 캘린더 자동 제외',
  },
  {
    name: 'nightlyStatsBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/nightlyStatsBatch.ts',
    description: '야간 통계 집계: 전체 기관 × 최근 2개월 월간 집계 캐싱 → superAdmin 대시보드 통계 캐시 재집계',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 2 * * *" (KST 02:00). dailyAggregation이 실행 시각 -3h를 기준월로 삼으므로 이 시각은 바꾸지 말 것',
  },
  {
    name: 'dailyNightlyBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/dailyNightlyBatch.ts',
    description: '야간 배치: Firestore 백업(GCS export) → 차량 보험 만료 15일 이내 알림',
    auth: '시스템 자동 실행',
    note: 'schedule: "20 2 * * *" (KST 02:20). 2026-08-28 Cloud Run 비용 점검에서 일곱 스텝 통합 배치를 집계·백업·주간 유지보수 셋으로 분리(1GiB→512MiB, 재시도 범위 축소)',
  },
  {
    name: 'weeklyMaintenanceBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/weeklyMaintenanceBatch.ts',
    description: '주간 유지보수: soft-delete 기관 30일 후 영구 삭제 → 증빙 이미지 정리 → 3년 이상 운행기록 GCS 아카이빙',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 3 * * 0" (KST 일요일 03:00). 판정 기준이 30일·3년이라 매일 돌 이유가 없어 주 1회로 옮긴 것',
  },
  {
    name: 'monthlyBatch',
    type: 'onSchedule',
    file: 'handlers/scheduled/monthlyBatch.ts',
    description: '통합 월배치: 공휴일 동기화(syncHolidays) + 차량 누적 주행거리 불일치 검증(verifyMileageConsistency)',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 6 1 * *" (매월 1일 오전 6시). 각 단계는 독립 try/catch',
  },
  {
    name: 'sendInactiveOrgAlimtalkScheduled',
    type: 'onSchedule',
    file: 'handlers/scheduled/sendInactiveOrgAlimtalkScheduled.ts',
    description: '미활성 기관 점검 및 주 1회 알림톡 발송',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 14 * * 1-5" — 평일 14시 점검',
  },

  // ── Firestore 트리거 (onCreate) ──
  {
    name: 'onReservationCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/reservationTriggers.ts',
    description: '예약 생성 시 Google Calendar 이벤트 생성 + 푸시 알림 발송',
    auth: '시스템 자동 실행',
    note: 'reservations/{reservationId}',
  },
  {
    name: 'onDriveLogCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/syncDriveLogKm.ts',
    description: '운행일지 생성 시 차량 누적 주행거리 증분 + 집계 통계 갱신. 이후 시점 기록이 있으면 연쇄 동기화.',
    auth: '시스템 자동 실행',
    note: 'driveLogs/{logId}',
  },
  {
    name: 'trackFirstEmployee',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/trackFirstEmployee.ts',
    description: '기관 첫 번째 직원 등록 시점을 Firestore에 기록',
    auth: '시스템 자동 실행',
    note: 'users/{uid}',
  },
  {
    name: 'generateFeedbackDraft',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/generateFeedbackDraft.ts',
    description: 'feedbacks/{feedbackId} 생성 시 Gemini API로 FAQ 매칭 + AI 답변 초안 자동 생성',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'onSlackTaskCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/onSlackTaskCreated.ts',
    description: 'Slack 어시스턴트 워커: 신원 매핑 → rate limit → 자연어 처리(예약 조회/생성 제안) 또는 확인 버튼 실행 → Slack 응답',
    auth: '시스템 자동 실행 (Firestore 트리거)',
    note: 'slackTasks/{taskId}. Admin SDK로 Rules를 우회하므로 이 워커의 org 검증이 유일한 방어선',
  },
  {
    name: 'auditDriveLogCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/auditLog.ts',
    description: '운행일지 생성 이력을 접속기록(accessLogs)에 기록 — 고시 「개인정보의 안전성 확보조치 기준」 제16조',
    auth: '시스템 자동 실행',
    note: 'driveLogs/{logId}. 화이트리스트 필드만 기록, retry: true',
  },
  {
    name: 'auditUserCreated',
    type: 'onDocumentCreated',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 문서 생성 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
    note: 'users/{userId}',
  },

  // ── Firestore 트리거 (onWrite) ──
  {
    name: 'autoVerifyDocument',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/autoVerifyDocument.ts',
    description: 'organizations/{orgId} 문서에 증빙서류(uniqueNumberImagePath, 레거시 uniqueNumberImageUrl)가 추가되면 Gemini OCR + 비영리 판별 → 자동 승인/거절 처리 및 이메일 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
    note: '화이트리스트 기관은 즉시 승인. 종교/학교/병원/영리 사업자는 자동 거절.',
  },
  {
    name: 'setCustomClaims',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/setCustomClaims.ts',
    description: 'users/{uid} 문서 변경 시 Firebase Auth Custom Claims (role, orgId) 자동 동기화',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'notifyNewApplication',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/notifyNewApplication.ts',
    description: '기관 신청(pending)/승인(approved)/거절(rejected) 상태 변화 시 이메일 및 Discord 알림 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'notifyRoleChange',
    type: 'onDocumentWritten',
    file: 'handlers/triggers/notifyRoleChange.ts',
    description: '사용자 권한(role) 변경 감지 시 Discord 보안 알림 발송',
    auth: '시스템 자동 실행',
    note: 'users/{uid}',
  },

  // ── Firestore 트리거 (onUpdate) ──
  {
    name: 'onReservationUpdated',
    type: 'onDocumentUpdated',
    file: 'handlers/triggers/reservationTriggers.ts',
    description: '예약 수정/취소 시 Google Calendar 이벤트 업데이트',
    auth: '시스템 자동 실행',
  },
  {
    name: 'onDriveLogUpdated',
    type: 'onDocumentUpdated',
    file: 'handlers/triggers/syncDriveLogKm.ts',
    description: '운행일지 수정 시 차량 누적 주행거리 재계산 + 집계 통계 갱신 (충돌 시 conflictResolver로 해소)',
    auth: '시스템 자동 실행',
  },
  {
    name: 'auditDriveLogUpdated',
    type: 'onDocumentUpdated',
    file: 'handlers/triggers/auditLog.ts',
    description: '운행일지 변경 이력을 접속기록(accessLogs)에 기록 (변경 전/후 화이트리스트 필드)',
    auth: '시스템 자동 실행',
  },
  {
    name: 'auditUserUpdated',
    type: 'onDocumentUpdated',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 개인정보 변경 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
  },

  // ── Firestore 트리거 (onDelete) ──
  {
    name: 'onReservationDeleted',
    type: 'onDocumentDeleted',
    file: 'handlers/triggers/reservationTriggers.ts',
    description: '예약 삭제 시 Google Calendar 이벤트 삭제',
    auth: '시스템 자동 실행',
  },
  {
    name: 'onDriveLogDeleted',
    type: 'onDocumentDeleted',
    file: 'handlers/triggers/syncDriveLogKm.ts',
    description: '운행일지 삭제 시 차량 누적 주행거리 되돌리기 + 집계 통계 갱신',
    auth: '시스템 자동 실행',
  },
  {
    name: 'auditDriveLogDeleted',
    type: 'onDocumentDeleted',
    file: 'handlers/triggers/auditLog.ts',
    description: '운행일지 삭제 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
  },
  {
    name: 'auditUserDeleted',
    type: 'onDocumentDeleted',
    file: 'handlers/triggers/auditLog.ts',
    description: '사용자 문서 삭제 이력을 접속기록(accessLogs)에 기록',
    auth: '시스템 자동 실행',
  },

  // ── Auth 트리거 ──
  {
    name: 'onUserDelete',
    type: 'onUserDeleted',
    file: 'handlers/triggers/onUserDelete.ts',
    description: 'Firebase Auth 계정 삭제 시 Firestore 개인정보 익명화 처리',
    auth: '시스템 자동 실행 (Auth 트리거)',
  },
];

// ── 타입별 이모지 ──
const TYPE_EMOJI: Record<string, string> = {
  onCall: '📞',
  onRequest: '🌐',
  onSchedule: '⏰',
  onDocumentCreated: '📝',
  onDocumentWritten: '✏️',
  onDocumentUpdated: '🔄',
  onDocumentDeleted: '🗑️',
  onUserDeleted: '👤',
};

const TYPE_LABEL: Record<string, string> = {
  onCall: 'onCall (클라이언트 직접 호출)',
  onRequest: 'onRequest (HTTP 요청)',
  onSchedule: 'onSchedule (스케줄)',
  onDocumentCreated: 'Firestore onCreate',
  onDocumentWritten: 'Firestore onWrite',
  onDocumentUpdated: 'Firestore onUpdate',
  onDocumentDeleted: 'Firestore onDelete',
  onUserDeleted: 'Auth 트리거',
};

// ── 마크다운 생성 ──
function generateMarkdown(functions: FunctionEntry[]): string {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const grouped: Record<string, FunctionEntry[]> = {};
  for (const fn of functions) {
    if (!grouped[fn.type]) grouped[fn.type] = [];
    grouped[fn.type].push(fn);
  }

  const typeOrder = [
    'onCall',
    'onRequest',
    'onSchedule',
    'onDocumentCreated',
    'onDocumentWritten',
    'onDocumentUpdated',
    'onDocumentDeleted',
    'onUserDeleted',
  ];

  let md = `# Cloud Functions 레퍼런스

> **자동 생성 문서** — \`scripts/generate-functions-doc.ts\`로 생성됨
>
> 마지막 업데이트: ${now}
>
> 총 함수 수: **${functions.length}개**

---

## 목차

`;

  for (const type of typeOrder) {
    if (!grouped[type]) continue;
    const emoji = TYPE_EMOJI[type] || '';
    const label = TYPE_LABEL[type] || type;
    md += `- [${emoji} ${label}](#${type.toLowerCase().replace(/\s/g, '-')})\n`;
  }

  md += '\n---\n';

  for (const type of typeOrder) {
    if (!grouped[type]) continue;
    const emoji = TYPE_EMOJI[type] || '';
    const label = TYPE_LABEL[type] || type;
    const fns = grouped[type];

    md += `\n## ${emoji} ${label}\n\n`;
    md += `> 총 ${fns.length}개\n\n`;

    for (const fn of fns) {
      md += `### \`${fn.name}\`\n\n`;
      md += `| 항목 | 내용 |\n|------|------|\n`;
      md += `| **파일** | \`functions/src/${fn.file}\` |\n`;
      md += `| **설명** | ${fn.description} |\n`;
      md += `| **인증** | ${fn.auth} |\n`;
      if (fn.params) md += `| **요청 파라미터** | \`${fn.params}\` |\n`;
      if (fn.returns) md += `| **반환값** | \`${fn.returns}\` |\n`;
      if (fn.note) md += `| **비고** | ${fn.note} |\n`;
      md += '\n';
    }

    md += '---\n';
  }

  md += `\n## 업데이트 방법\n\n`;
  md += `새 함수를 추가하거나 변경했을 때:\n\n`;
  md += `\`\`\`bash\nnpx tsx scripts/generate-functions-doc.ts\n\`\`\`\n\n`;
  md += `\`scripts/generate-functions-doc.ts\`의 \`FUNCTIONS\` 배열에 항목을 추가(또는 수정)한 뒤 위 명령을 실행한다. `;
  md += `배열의 \`name\`은 \`functions/src/index.ts\`의 export 목록과 1:1로 일치해야 한다.\n`;

  return md;
}

// ── 실행 ──
const markdown = generateMarkdown(FUNCTIONS);

// docs/ 디렉터리 없으면 생성
const docsDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, markdown, 'utf-8');
console.log(`✅ 문서 생성 완료: ${OUTPUT_PATH}`);
console.log(`   총 함수: ${FUNCTIONS.length}개`);
