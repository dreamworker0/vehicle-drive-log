/**
 * reservationReminderScheduler — 예약 알림 스케줄러 (D13 규칙 준수: index.ts에서 분리)
 *
 * 15분마다 실행하여 예약 임박 알림 및 미작성 운행일지 알림을 발송한다.
 * 주말(토/일)에는 비용 절감을 위해 스킵한다.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { checkReservationReminders } from "./reservationReminder";
import { recordHeartbeat } from "./helpers";

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
