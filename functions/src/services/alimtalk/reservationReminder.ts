import { getFirestore } from "firebase-admin/firestore";
import { sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";
import { toKSTDate, getKSTDateString } from "../../utils/kstDate";

const db = getFirestore();

/**
 * 예약 시작 10분 전 알림 + 운행일지 미작성 알림 전송
 * Cloud Functions Scheduler에서 15분마다 호출 (비용 최적화 적용됨)
 */
export async function checkReservationReminders(): Promise<void> {
    const now = new Date();
    const kstNow = toKSTDate(now);

    const todayStr = getKSTDateString(now);
    const currentHH = String(kstNow.getHours()).padStart(2, "0");
    const currentMM = String(kstNow.getMinutes()).padStart(2, "0");
    const currentTime = `${currentHH}:${currentMM}`;

    // 10분 후 시각 계산
    const tenMinLater = new Date(kstNow.getTime() + 10 * 60 * 1000);
    const laterHH = String(tenMinLater.getHours()).padStart(2, "0");
    const laterMM = String(tenMinLater.getMinutes()).padStart(2, "0");
    const tenMinLaterTime = `${laterHH}:${laterMM}`;

    console.log(`[Reminder] Check at ${todayStr} ${currentTime} (KST), 10min later = ${tenMinLaterTime}`);

    try {
        // === 1. 예약 시작 10분 전 알림 ===
        const reservationsSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "==", "reserved")
            .where("startTime", ">=", currentTime)
            .where("startTime", "<=", tenMinLaterTime)
            .get();

        let reminderCount = 0;
        for (const doc of reservationsSnap.docs) {
            const res = doc.data();
            if (res.reminderSent) continue;

            const targetUid = res.reservedByUid || res.userId;
            if (targetUid) {
                const title = "🚗 예약 임박";
                const body = `${res.vehicleDisplayName || "차량"} 예약이 ${res.startTime}에 시작됩니다.`;

                await sendPushToUser(targetUid, { title, body });
                await createInAppNotification(targetUid, "reservation_reminder", title, body, res.organizationId);

                await db.collection("reservations").doc(doc.id).update({
                    reminderSent: true,
                });

                reminderCount++;
            }
        }

        // === 2. 운행일지 미작성 알림 ===
        const completedSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "in", ["completed", "in_progress"])
            .get();

        let missedCount = 0;
        for (const doc of completedSnap.docs) {
            const res = doc.data();
            if (res.endTime && res.endTime > currentTime) continue;
            if (res.driveLogReminderSent) continue;

            const targetUid = res.reservedByUid || res.userId;
            if (targetUid) {
                const logsSnap = await db.collection("driveLogs")
                    .where("reservationId", "==", doc.id)
                    .limit(1)
                    .get();

                if (logsSnap.empty) {
                    const title = "📝 운행일지 작성 알림";
                    const body = `${res.vehicleDisplayName || "차량"} 운행이 종료되었습니다. 운행일지를 작성해주세요.`;

                    await sendPushToUser(targetUid, { title, body });
                    await createInAppNotification(targetUid, "drive_log_reminder", title, body, res.organizationId);

                    await db.collection("reservations").doc(doc.id).update({
                        driveLogReminderSent: true,
                    });

                    missedCount++;
                }
            }
        }

        // === 3. 미출발(No-show) 알림 ===
        const fifteenMinAgo = new Date(kstNow.getTime() - 15 * 60 * 1000);
        const agoHH = String(fifteenMinAgo.getHours()).padStart(2, "0");
        const agoMM = String(fifteenMinAgo.getMinutes()).padStart(2, "0");
        const fifteenMinAgoTime = `${agoHH}:${agoMM}`;

        const noShowSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "==", "reserved")
            .where("startTime", "<=", fifteenMinAgoTime)
            .get();

        let noShowCount = 0;
        for (const doc of noShowSnap.docs) {
            const res = doc.data();
            if (res.noShowReminderSent) continue;

            const targetUid = res.reservedByUid || res.userId;
            if (targetUid) {
                const cancelUrl = `https://vehicle-drive-log.web.app?cancelReservation=${doc.id}`;
                const title = "🚨 예약 시작시간이 지났습니다";
                const body = `${res.vehicleDisplayName || "차량"} 예약(${res.startTime})이 시작되었으나 운행이 시작되지 않았습니다. 탭하여 예약을 취소하거나 유지하세요.`;

                await sendPushToUser(targetUid, { title, body }, {
                    link: cancelUrl,
                    reservationId: doc.id,
                    action: "cancel_prompt",
                });
                await createInAppNotification(targetUid, "no_show_reminder", title, body, res.organizationId);

                await db.collection("reservations").doc(doc.id).update({
                    noShowReminderSent: true,
                });

                noShowCount++;
            }
        }

        console.log(`[Reminder] Sent ${reminderCount} upcoming, ${missedCount} drive log, ${noShowCount} no-show reminders`);
    } catch (err: unknown) {
        console.error("[Reminder] Failed:", (err as Error).message);
    }
}
