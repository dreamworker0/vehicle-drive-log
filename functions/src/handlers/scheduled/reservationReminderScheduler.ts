/**
 * reservationReminderScheduler — 예약 알림 스케줄러 (D13 규칙 준수: index.ts에서 분리)
 *
 * 평일 08~18시, 매시 정각에 실행하여 예약 임박 알림 및 미작성 운행일지 알림을 발송한다.
 * 비용 최적화: 15분→1시간 주기로 변경, 주말/야간 제외 (App Engine cron → 표준 cron 전환)
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { checkReservationReminders } from "../../services/alimtalk/reservationReminder";
import { recordHeartbeat } from "../../utils/helpers";

export const reservationReminder = onSchedule(
    {
        schedule: "0 8-18 * * 1-5",
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
