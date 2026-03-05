const { initializeApp } = require("firebase-admin/app");

// Firebase Admin 초기화
initializeApp();

// OCR Functions
const { ocrDashboard } = require("./ocrDashboard");
const { ocrDocument } = require("./ocrDocument");
const { autoVerifyDocument } = require("./autoVerifyDocument");

exports.ocrDashboard = ocrDashboard;
exports.ocrDocument = ocrDocument;
exports.autoVerifyDocument = autoVerifyDocument;

// Holiday Proxy
const { holidayProxy } = require("./holidayProxy");
exports.holidayProxy = holidayProxy;

// Holiday Sync Scheduler (오전 6시마다 실행)
const { syncHolidaysScheduled } = require("./syncHolidays");
exports.syncHolidaysScheduled = syncHolidaysScheduled;

// Tmap Proxy (프로덕션 CORS 해결)
const { tmapProxy } = require("./tmapProxy");
exports.tmapProxy = tmapProxy;

// 데이터 백업 & 자동 퍼지 & 아카이빙
const { backupFirestore } = require("./backupFirestore");
const { autoPurgeOrgs } = require("./autoPurgeOrgs");
const { archiveDriveLogs } = require("./archiveDriveLogs");
exports.backupFirestore = backupFirestore;
exports.autoPurgeOrgs = autoPurgeOrgs;
exports.archiveDriveLogs = archiveDriveLogs;

// Admin Notice
const { sendAdminNotice } = require("./sendAdminNotice");
exports.sendAdminNotice = sendAdminNotice;

// 예약 생성 (중복 방지 — Firestore Transaction)
const { createReservationSafe } = require("./createReservationSafe");
exports.createReservationSafe = createReservationSafe;

// 기관 신청 이메일 알림
const { notifyNewApplication } = require("./notifyNewApplication");
exports.notifyNewApplication = notifyNewApplication;

// Reservation Reminder (예약 알림 + 미작성 알림)
const { checkReservationReminders } = require("./reservationReminder");
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.reservationReminder = onSchedule(
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
const { warmupOcrFunction } = require("./warmupOcr");

exports.warmupOcr = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async function () {
        await warmupOcrFunction();
    }
);

// ========================
// 예약 트리거 (Google Calendar 연동 + 푸시 알림)
// ========================
const { onReservationCreated, onReservationUpdated, onReservationDeleted } = require("./reservationTriggers");
exports.onReservationCreated = onReservationCreated;
exports.onReservationUpdated = onReservationUpdated;
exports.onReservationDeleted = onReservationDeleted;

// ========================
// Google Calendar -> App 역동기화 (10분마다)
// ========================
const { syncCalendarToApp } = require("./calendarSchedule");
exports.syncCalendarToApp = syncCalendarToApp;

// ========================
// 운행일지 중복 정리 (관리자용)
// ========================
const { cleanupDuplicateLogs } = require("./cleanupDuplicateLogs");
exports.cleanupDuplicateLogs = cleanupDuplicateLogs;
