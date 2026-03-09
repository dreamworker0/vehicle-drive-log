import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";

// Firebase Admin 초기화
initializeApp();

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

// Admin Notice
export { sendAdminNotice } from "./sendAdminNotice";

// 예약 생성 (중복 방지 — Firestore Transaction)
export { createReservationSafe } from "./createReservationSafe";

// 기관 신청 이메일 알림
export { notifyNewApplication } from "./notifyNewApplication";

// Reservation Reminder (예약 알림 + 미작성 알림)
import { checkReservationReminders } from "./reservationReminder";

export const reservationReminder = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async function () {
        await checkReservationReminders();
    }
);

// OCR 워밍업 스케줄러 (근무시간 콜드 스타트 방지)
import { warmupOcrFunction } from "./warmupOcr";

export const warmupOcr = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async function () {
        await warmupOcrFunction();
    }
);

// 예약 트리거 (Google Calendar 연동 + 푸시 알림)
export { onReservationCreated, onReservationUpdated, onReservationDeleted } from "./reservationTriggers";

// Google Calendar -> App 역동기화 (10분마다)
export { syncCalendarToApp } from "./calendarSchedule";

// 운행일지 중복 정리 (관리자용)
export { cleanupDuplicateLogs } from "./cleanupDuplicateLogs";

// 직원 삭제 (Auth 비활성화 + Firestore 삭제)
export { disableUser } from "./disableUser";

// 계정 복원 (Auth 재활성화 + Firestore 재생성)
export { restoreUser } from "./restoreUser";

// Custom Claims 자동 동기화 (users 문서 변경 → Auth Claims 설정)
export { setCustomClaims } from "./setCustomClaims";
