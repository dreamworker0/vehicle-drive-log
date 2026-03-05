const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { sendPushToUser } = require("./sendNotification");

const db = getFirestore();

/**
 * 예약 시작 10분 전 알림 전송 + 운행일지 미작성 알림 전송
 * Cloud Functions Scheduler에서 5분마다 호출
 */
async function checkReservationReminders() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);

    const todayStr = kstNow.toISOString().slice(0, 10);
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
            // 이미 알림 보낸 예약은 스킵
            if (res.reminderSent) continue;

            if (res.userId) {
                await sendPushToUser(res.userId, {
                    title: "🚗 예약 임박",
                    body: `${res.vehicleDisplayName || "차량"} 예약이 ${res.startTime}에 시작됩니다.`,
                });

                // 알림 발송 표시
                await db.collection("reservations").doc(doc.id).update({
                    reminderSent: true,
                });

                reminderCount++;
            }
        }

        // === 2. 운행일지 미작성 알림 ===
        // 종료 시간이 지난 예약 중 completed/in_progress 상태이고 일지가 없는 것
        const completedSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "in", ["completed", "in_progress"])
            .get();

        let missedCount = 0;
        for (const doc of completedSnap.docs) {
            const res = doc.data();
            // 종료 시간이 아직 안 지났으면 스킵
            if (res.endTime && res.endTime > currentTime) continue;
            // 이미 알림 보냈으면 스킵
            if (res.driveLogReminderSent) continue;

            // 연결된 운행일지가 있는지 확인
            if (res.userId) {
                const logsSnap = await db.collection("driveLogs")
                    .where("reservationId", "==", doc.id)
                    .limit(1)
                    .get();

                if (logsSnap.empty) {
                    await sendPushToUser(res.userId, {
                        title: "📝 운행일지 작성 알림",
                        body: `${res.vehicleDisplayName || "차량"} 운행이 종료되었습니다. 운행일지를 작성해주세요.`,
                    });

                    await db.collection("reservations").doc(doc.id).update({
                        driveLogReminderSent: true,
                    });

                    missedCount++;
                }
            }
        }

        // === 3. 미출발(No-show) 알림 ===
        // 시작 시간이 15분 이상 경과했지만 아직 reserved 상태인 예약
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
            // 이미 미출발 알림을 보냈으면 스킵
            if (res.noShowReminderSent) continue;

            if (res.userId) {
                const cancelUrl = `https://vehicle-drive-log.web.app?cancelReservation=${doc.id}`;

                await sendPushToUser(res.userId, {
                    title: "🚨 예약 시작시간이 지났습니다",
                    body: `${res.vehicleDisplayName || "차량"} 예약(${res.startTime})이 시작되었으나 운행이 시작되지 않았습니다. 탭하여 예약을 취소하거나 유지하세요.`,
                }, {
                    link: cancelUrl,
                    reservationId: doc.id,
                    action: "cancel_prompt",
                });

                await db.collection("reservations").doc(doc.id).update({
                    noShowReminderSent: true,
                });

                noShowCount++;
            }
        }

        console.log(`[Reminder] Sent ${reminderCount} upcoming, ${missedCount} drive log, ${noShowCount} no-show reminders`);
    } catch (err) {
        console.error("[Reminder] Failed:", err.message);
    }
}

module.exports = { checkReservationReminders };
