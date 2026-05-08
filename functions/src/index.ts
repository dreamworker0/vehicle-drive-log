import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { recordHeartbeat } from "./helpers";

// 시스템 전역 옵션 - 유휴 리소스 절감 및 불필요한 과금 방지
setGlobalOptions({ 
    maxInstances: 10, 
    memory: "512MiB", 
    timeoutSeconds: 120, 
    region: "asia-northeast3",
    concurrency: 80
});

// Firebase Admin 초기화 (모든 다른 모듈보다 먼저 실행되어야 함)
initializeApp();

// Sentry 에러 모니터링 초기화 (initializeApp 이후에 로드)
import "./sentry";

// OCR Functions
export { ocrDashboard } from "./ocrDashboard";
export { ocrDocument } from "./ocrDocument";
export { autoVerifyDocument } from "./autoVerifyDocument";

// Holiday Proxy
export { holidayProxy } from "./holidayProxy";

// Holiday Sync Scheduler (오전 6시마다 실행)
export { syncHolidaysScheduled } from "./syncHolidays";

// Tmap Proxy (프로덕션 CORS 해결)
export { tmapProxy } from "./tmapProxy";

// 데이터 백업 & 자동 퍼지 & 아카이빙
export { backupFirestore } from "./backupFirestore";
export { autoPurgeOrgs } from "./autoPurgeOrgs";
export { archiveDriveLogs } from "./archiveDriveLogs";
export { cleanupCertificateImages } from "./cleanupCertificateImages";

// Admin Notice
export { sendAdminNotice } from "./sendAdminNotice";

// 예약 생성 (중복 방지 — Firestore Transaction)
export { createReservationSafe } from "./createReservationSafe";

// 기관 신청 이메일 알림
export { notifyNewApplication } from "./notifyNewApplication";

// 기관 승인 이메일 발송 (서버사이드)
export { sendApprovalEmail } from "./sendApprovalEmail";

// 기관 거절 이메일 발송 (서버사이드)
export { sendRejectionEmail } from "./sendRejectionEmail";

// 수동 승인 시 알림톡 발송
export { sendManualApprovalAlimtalk } from "./sendManualApprovalAlimtalk";

// Reservation Reminder (예약 알림 + 미작성 알림)
import { checkReservationReminders } from "./reservationReminder";

export const reservationReminder = onSchedule(
    {
        schedule: "every 15 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async function () {
        // 주말(토/일)에는 스킵 (비용 절감)
        const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const dayOfWeek = nowKST.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            await recordHeartbeat("reservationReminder");
            return;
        }
        await checkReservationReminders();
        await recordHeartbeat("reservationReminder");
    }
);



// 예약 트리거 (Google Calendar 연동 + 푸시 알림)
export { onReservationCreated, onReservationUpdated, onReservationDeleted } from "./reservationTriggers";

// Google Calendar -> App 역동기화 (2시간마다)
export { syncCalendarToApp } from "./calendarSchedule";

// (Google Calendar Push Webhook 기능은 도메인 인증 문제로 보류됨)

// 운행일지 중복 정리 (관리자용)
export { cleanupDuplicateLogs } from "./cleanupDuplicateLogs";

// 대시보드 성능 고도화를 위한 운행일지 집계 통계 캐싱 (현재 syncDriveLogKm.ts 통합 트리거 내부에서 병합 처리됨)
// 집계 통계 일괄 재계산 (마이그레이션/보정용)
export { recalculateAggregatedStats } from "./caching/recalculateAggregatedStats";

// SuperAdmin 대시보드 통계 캐싱 (1시간 주기 배치)
import { computeAllDashboardStats } from "./caching/computeDashboardStats";

export const computeDashboardStats = onSchedule(
    {
        schedule: "every 1 hours",
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 300,
    },
    async function () {
        await computeAllDashboardStats();
        await recordHeartbeat("computeDashboardStats");
    }
);

// SuperAdmin 대시보드 통계 수동 갱신
export { refreshDashboardStats } from "./caching/refreshDashboardStats";

// 직원 삭제 (Auth 비활성화 + Firestore 삭제)
export { disableUser } from "./disableUser";

// 계정 복원 (Auth 재활성화 + Firestore 재생성)
export { restoreUser } from "./restoreUser";

// Custom Claims 자동 동기화 (users 문서 변경 → Auth Claims 설정)
export { setCustomClaims } from "./setCustomClaims";

// 초대 코드로 기관 가입 (신규 사용자 Custom Claims 미보유 대응)
export { joinOrganization } from "./joinOrganization";

// 첫 직원 등록 시점 추적
export { trackFirstEmployee } from "./trackFirstEmployee";

// 기존 기관 좌표 마이그레이션 (일회성)
export { backfillOrgCoords } from "./backfillOrgCoords";

// 피드백 AI 답변 초안 생성 (의견 등록 시 자동 실행)
export { generateFeedbackDraft } from "./generateFeedbackDraft";

// 피드백 AI 답변 수동 재생성 (관리자 호출)
export { regenerateFeedbackDraft } from "./regenerateFeedbackDraft";

// 피드백 답변 발송 (슈퍼관리자 → 사용자 알림)
export { sendFeedbackReply } from "./sendFeedbackReply";

// AI에게 물어보기 (FAQ 기반 Gemini 답변)
export { askAI } from "./askAI";

// 슈퍼관리자 API 헬스 체크
export { apiHealthCheck } from "./apiHealthCheck";

// 캘린더 동기화 실패 카운터 리셋 (슈퍼관리자용)
export { resetCalendarSyncFails } from "./scripts/resetCalendarSyncFails";

// 캘린더 접근 테스트 (관리자용)
export { testCalendarAccess } from "./testCalendarAccess";



// 미활성 기관 일괄 알림톡 발송
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendReminderAlimtalk } from "./sendAlimtalk";

export const sendBulkReminder = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120, enforceAppCheck: false },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        // superAdmin 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        const db = getFirestore();

        // 승인된 기관 조회
        const orgsSnap = await db.collection("organizations")
            .where("status", "==", "approved")
            .get();

        const results: { orgName: string; phone: string; success: boolean; message?: string }[] = [];
        let sentCount = 0;
        let failCount = 0;
        let noPhoneCount = 0;

        for (const orgDoc of orgsSnap.docs) {
            const org = orgDoc.data();

            // 직원 수 확인 (0명 = 미활성)
            const membersSnap = await db.collection("users")
                .where("organizationId", "==", orgDoc.id)
                .limit(1)
                .get();

            if (!membersSnap.empty) continue; // 직원이 있으면 건너뛰기

            // 전화번호 확인
            const phone = org.applicantPhone || org.phone;
            if (!phone) {
                noPhoneCount++;
                results.push({ orgName: org.name, phone: "-", success: false, message: "전화번호 없음" });
                continue;
            }

            // 알림톡 발송
            const name = org.applicantName || org.name;
            const inviteCode = org.inviteCode || "";

            if (!inviteCode) {
                results.push({ orgName: org.name, phone, success: false, message: "초대코드 없음" });
                failCount++;
                continue;
            }

            const result = await sendReminderAlimtalk(phone, name, org.name, inviteCode);

            if (result.success) {
                sentCount++;
            } else {
                failCount++;
            }

            results.push({
                orgName: org.name,
                phone,
                success: result.success,
                message: result.message,
            });
        }

        console.log(`[BulkReminder] 완료: 성공 ${sentCount}, 실패 ${failCount}, 번호없음 ${noPhoneCount}`);

        return { sentCount, failCount, noPhoneCount, results };
    }
);

// 미활성 기관 발송 스케줄러 (매주 월~금 14시 점검, 주 1회 발송)
export { sendInactiveOrgAlimtalkScheduled } from "./sendInactiveOrgAlimtalkScheduled";

// 사용자 권한 변경 탐지 (보안 알림)
export { notifyRoleChange } from "./notifyRoleChange";

// 디스코드 정기 리포트 및 미활성 알림 스케줄러
export { scheduledDiscordBriefing } from "./discordScheduler";

// 익명 로그인 대체용 기관 신청 API
export { submitOrgApplication } from "./submitOrgApplication";

// 랜딩 페이지 비번/기관 미로그인 유저의 문의 접수용 API
export { submitPublicFeedback } from "./submitPublicFeedback";

// 차량 누적 주행거리 오차 검증 스케줄러 (매월 1일 실행)
export { verifyMileageConsistency } from "./scheduler/verifyMileageConsistency";

// 회원 탈퇴 시 개인정보 익명화 트리거
export { onUserDelete } from "./onUserDelete";

// 운행일지 생성/수정/삭제 시 차량 주행거리 증분 및 자동 연쇄 동기화
export { onDriveLogCreated, onDriveLogUpdated, onDriveLogDeleted } from "./syncDriveLogKm";
