#!/usr/bin/env ts-node
/**
 * generate-functions-doc.ts
 *
 * Cloud Functions 레퍼런스 마크다운 자동 생성 스크립트
 *
 * 사용법:
 *   npx esno scripts/generate-functions-doc.ts
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
    file: 'ocrDashboard.ts',
    description: '계기판 사진을 Gemini Vision API로 분석하여 현재 주행거리(km)와 배터리%(EV) 추출',
    auth: '기관 멤버 (인증 필수)',
    params: '{ imageBase64: string, mimeType: string }',
    returns: '{ km: number | null, batteryPercent: number | null }',
  },
  {
    name: 'ocrDocument',
    type: 'onCall',
    file: 'ocrDocument.ts',
    description: '사업자등록증/고유번호증 이미지를 OCR하여 기관명, 사업자번호, 주소 추출',
    auth: '인증 필수',
    params: '{ imageBase64: string, mimeType: string }',
    returns: '{ orgName: string, bizNumber: string, address: string }',
  },
  {
    name: 'autoVerifyDocument',
    type: 'onDocumentWritten',
    file: 'autoVerifyDocument.ts',
    description: 'organizations/{orgId} 문서에 uniqueNumberImageUrl이 추가되면 Gemini OCR + 비영리 판별 → 자동 승인/거절 처리 및 이메일 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
    note: '화이트리스트 기관은 즉시 승인. 종교/학교/병원/영리 사업자는 자동 거절.',
  },

  // ── 프록시 ──
  {
    name: 'tmapProxy',
    type: 'onRequest',
    file: 'tmapProxy.ts',
    description: '클라이언트에서 Tmap API를 CORS 없이 호출하기 위한 서버사이드 프록시',
    auth: 'IP 기반 Rate Limit (분당 60회)',
    params: 'query params: endpoint, keyword 등 (Tmap API 파라미터)',
  },
  {
    name: 'holidayProxy',
    type: 'onRequest',
    file: 'holidayProxy.ts',
    description: '공공데이터포털 공휴일 API 프록시. API 키를 서버에서 관리.',
    auth: '없음 (공개 API)',
  },

  // ── 스케줄러 ──
  {
    name: 'reservationReminder',
    type: 'onSchedule',
    file: 'reservationReminder.ts',
    description: '15분마다 예약 알림(D-1, 당일) 및 미작성 운행일지 알림 발송. 주말 자동 스킵.',
    auth: '시스템 자동 실행',
    note: 'schedule: "every 15 minutes" (Asia/Seoul), 주말 스킵',
  },
  {
    name: 'monthlyBatch',
    type: 'onSchedule',
    file: 'monthlyBatch.ts',
    description: '통합 월배치: 공휴일 동기화(syncHolidays) + 차량 마일리지 불일치 검증(verifyMileageConsistency)',
    auth: '시스템 자동 실행',
    note: 'schedule: "0 6 1 * *" (매월 1일 오전 6시)',
  },
  {
    name: 'syncCalendarToApp',
    type: 'onSchedule',
    file: 'calendarSchedule.ts',
    description: 'Google Calendar → App 역방향 동기화. 외부에서 캘린더 이벤트 변경 시 App DB에 반영.',
    auth: '시스템 자동 실행',
    note: 'schedule: "every 2 hours"',
  },
  {
    name: 'backupFirestore',
    type: 'onSchedule',
    file: 'backupFirestore.ts',
    description: 'Firestore 전체 데이터를 Cloud Storage에 자동 백업',
    auth: '시스템 자동 실행',
  },
  {
    name: 'autoPurgeOrgs',
    type: 'onSchedule',
    file: 'autoPurgeOrgs.ts',
    description: '일정 기간 미사용 기관 자동 정리 (퍼지)',
    auth: '시스템 자동 실행',
  },
  {
    name: 'archiveDriveLogs',
    type: 'onSchedule',
    file: 'archiveDriveLogs.ts',
    description: '오래된 운행일지를 아카이브 컬렉션으로 이동하여 DB 비용 절감',
    auth: '시스템 자동 실행',
  },
  {
    name: 'sendInactiveOrgAlimtalkScheduled',
    type: 'onSchedule',
    file: 'sendInactiveOrgAlimtalkScheduled.ts',
    description: '매주 월~금 14시 미활성 기관 점검 및 주 1회 알림톡 발송',
    auth: '시스템 자동 실행',
  },
  {
    name: 'scheduledDiscordBriefing',
    type: 'onSchedule',
    file: 'discordScheduler.ts',
    description: '정기 Discord 브리핑 및 미활성 기관 알림',
    auth: '시스템 자동 실행',
  },
  {
    name: 'verifyMileageConsistency',
    type: 'onSchedule',
    file: 'scheduler/verifyMileageConsistency.ts',
    description: '매월 1일 차량 누적 주행거리 오차 검증',
    auth: '시스템 자동 실행',
  },

  // ── Firestore 트리거 ──
  {
    name: 'setCustomClaims',
    type: 'onDocumentWritten',
    file: 'setCustomClaims.ts',
    description: 'users/{uid} 문서 변경 시 Firebase Auth Custom Claims (role, orgId) 자동 동기화',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'notifyNewApplication',
    type: 'onDocumentWritten',
    file: 'notifyNewApplication.ts',
    description: '기관 신청(pending)/승인(approved)/거절(rejected) 상태 변화 시 이메일 및 Discord 알림 발송',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'generateFeedbackDraft',
    type: 'onDocumentCreated',
    file: 'generateFeedbackDraft.ts',
    description: 'feedbacks/{feedbackId} 생성 시 Gemini API로 FAQ 매칭 + AI 답변 초안 자동 생성',
    auth: '시스템 자동 실행 (Firestore 트리거)',
  },
  {
    name: 'onReservationCreated',
    type: 'onDocumentCreated',
    file: 'reservationTriggers.ts',
    description: '예약 생성 시 Google Calendar 이벤트 생성 + 푸시 알림 발송',
    auth: '시스템 자동 실행',
  },
  {
    name: 'onReservationUpdated',
    type: 'onDocumentWritten',
    file: 'reservationTriggers.ts',
    description: '예약 수정 시 Google Calendar 이벤트 업데이트',
    auth: '시스템 자동 실행',
  },
  {
    name: 'onReservationDeleted',
    type: 'onDocumentDeleted',
    file: 'reservationTriggers.ts',
    description: '예약 삭제 시 Google Calendar 이벤트 삭제',
    auth: '시스템 자동 실행',
  },
  {
    name: 'updateAggregatedStats',
    type: 'onDocumentWritten',
    file: 'caching/updateAggregatedStats.ts',
    description: '운행일지 생성/수정/삭제 시 기관별 집계 통계 실시간 업데이트',
    auth: '시스템 자동 실행',
  },
  {
    name: 'trackFirstEmployee',
    type: 'onDocumentCreated',
    file: 'trackFirstEmployee.ts',
    description: '기관 첫 번째 직원 등록 시점을 Firestore에 기록',
    auth: '시스템 자동 실행',
  },
  {
    name: 'notifyRoleChange',
    type: 'onDocumentWritten',
    file: 'notifyRoleChange.ts',
    description: '사용자 권한(role) 변경 감지 시 Discord 보안 알림 발송',
    auth: '시스템 자동 실행',
  },
  {
    name: 'onUserDelete',
    type: 'onUserDeleted',
    file: 'onUserDelete.ts',
    description: 'Firebase Auth 계정 삭제 시 Firestore 개인정보 익명화 처리',
    auth: '시스템 자동 실행 (Auth 트리거)',
  },

  // ── onCall 함수 ──
  {
    name: 'createReservationSafe',
    type: 'onCall',
    file: 'createReservationSafe.ts',
    description: 'Firestore Transaction으로 예약 중복을 방지하며 안전하게 예약 생성',
    auth: '인증된 기관 멤버',
    params: '{ organizationId, vehicleId, vehicleName, date, startTime, endTime, purpose, destination, reservedByUid, reservedByName }',
    returns: '{ success: boolean, reservationId: string }',
  },
  {
    name: 'joinOrganization',
    type: 'onCall',
    file: 'joinOrganization.ts',
    description: '초대 코드로 기관에 가입. 신규 사용자가 Custom Claims 미보유 시에도 정상 처리.',
    auth: '인증 필수',
    params: '{ inviteCode: string }',
    returns: '{ success: boolean, organizationId: string }',
  },
  {
    name: 'disableUser',
    type: 'onCall',
    file: 'disableUser.ts',
    description: 'Firebase Auth 비활성화 + Firestore 사용자 문서 삭제 (직원 제거)',
    auth: '기관 관리자 이상 (manager/superAdmin)',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'restoreUser',
    type: 'onCall',
    file: 'restoreUser.ts',
    description: '비활성화된 계정을 Auth 재활성화 + Firestore 문서 복원',
    auth: '기관 관리자 이상',
    params: '{ uid: string }',
    returns: '{ success: boolean }',
  },
  {
    name: 'sendAdminNotice',
    type: 'onCall',
    file: 'sendAdminNotice.ts',
    description: '관리자가 기관 전체 직원에게 알림을 발송',
    auth: '기관 관리자 이상',
    params: '{ organizationId: string, title: string, message: string }',
  },
  {
    name: 'refreshDashboardStats',
    type: 'onCall',
    file: 'caching/refreshDashboardStats.ts',
    description: 'SuperAdmin 대시보드 통계 수동 갱신 (즉시 재계산)',
    auth: 'superAdmin',
    returns: '{ success: boolean }',
  },
  {
    name: 'recalculateAggregatedStats',
    type: 'onCall',
    file: 'caching/recalculateAggregatedStats.ts',
    description: '집계 통계 일괄 재계산. 마이그레이션/데이터 보정 시 사용.',
    auth: 'superAdmin',
  },
  {
    name: 'cleanupDuplicateLogs',
    type: 'onCall',
    file: 'cleanupDuplicateLogs.ts',
    description: '중복된 운행일지 탐지 및 일괄 정리 (관리자용)',
    auth: '기관 관리자 이상',
  },
  {
    name: 'resetCalendarSyncFails',
    type: 'onCall',
    file: 'scripts/resetCalendarSyncFails.ts',
    description: '캘린더 동기화 실패 카운터 초기화',
    auth: 'superAdmin',
  },
  {
    name: 'testCalendarAccess',
    type: 'onCall',
    file: 'testCalendarAccess.ts',
    description: 'Google Calendar API 접근 가능 여부 테스트 (관리자 진단용)',
    auth: '기관 관리자 이상',
  },
  {
    name: 'sendManualApprovalAlimtalk',
    type: 'onCall',
    file: 'sendManualApprovalAlimtalk.ts',
    description: '수동 승인 시 신청자에게 카카오 알림톡 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendApprovalEmail',
    type: 'onCall',
    file: 'sendApprovalEmail.ts',
    description: '기관 승인 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'sendRejectionEmail',
    type: 'onCall',
    file: 'sendRejectionEmail.ts',
    description: '기관 거절 이메일 서버사이드 발송',
    auth: 'superAdmin',
  },
  {
    name: 'regenerateFeedbackDraft',
    type: 'onCall',
    file: 'regenerateFeedbackDraft.ts',
    description: 'AI 피드백 답변 초안 수동 재생성 (관리자 호출)',
    auth: 'superAdmin',
  },
  {
    name: 'sendFeedbackReply',
    type: 'onCall',
    file: 'sendFeedbackReply.ts',
    description: '슈퍼관리자가 피드백 답변 발송. 이메일 또는 알림톡으로 사용자에게 전달.',
    auth: 'superAdmin',
    params: '{ feedbackId: string, reply: string }',
  },
  {
    name: 'askAI',
    type: 'onCall',
    file: 'askAI.ts',
    description: 'FAQ 기반 Gemini AI 답변 (앱 내 "AI에게 물어보기" 기능)',
    auth: '인증 필수',
    params: '{ question: string }',
    returns: '{ answer: string, faqId: string | null, confidence: number }',
  },
  {
    name: 'apiHealthCheck',
    type: 'onCall',
    file: 'apiHealthCheck.ts',
    description: '외부 API(Tmap, Gemini, EmailJS, Discord) 및 Firestore 연결 상태 종합 점검',
    auth: 'superAdmin',
    returns: '{ status: "ok" | "degraded", services: Record<string, boolean> }',
  },
  {
    name: 'sendBulkReminder',
    type: 'onCall',
    file: 'index.ts (inline)',
    description: '미활성 기관(직원 0명)에게 알림톡 일괄 발송',
    auth: 'superAdmin',
    returns: '{ sentCount, failCount, noPhoneCount, results }',
  },
  {
    name: 'submitOrgApplication',
    type: 'onCall',
    file: 'submitOrgApplication.ts',
    description: '익명(비로그인) 사용자가 기관 신청서를 제출하는 엔드포인트',
    auth: '없음 (공개 — App Check 보호)',
  },
  {
    name: 'submitPublicFeedback',
    type: 'onCall',
    file: 'submitPublicFeedback.ts',
    description: '랜딩 페이지 비로그인 방문자 문의 접수',
    auth: '없음 (공개 — App Check 보호)',
  },
  {
    name: 'backfillOrgCoords',
    type: 'onCall',
    file: 'backfillOrgCoords.ts',
    description: '기존 기관에 좌표(lat/lng) 추가 (일회성 마이그레이션)',
    auth: 'superAdmin',
  },
  {
    name: 'cleanupCertificateImages',
    type: 'onSchedule',
    file: 'cleanupCertificateImages.ts',
    description: '처리 완료된 기관 신청 증명서 이미지를 Storage에서 정리',
    auth: '시스템 자동 실행',
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
> 마지막 업데이트: ${now}  
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
  md += `\`\`\`bash\nnpx ts-node scripts/generate-functions-doc.ts\n\`\`\`\n\n`;
  md += `또는 \`scripts/generate-functions-doc.ts\`의 \`FUNCTIONS\` 배열에 항목을 추가 후 실행.\n`;

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
