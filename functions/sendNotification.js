const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const db = getFirestore();

/**
 * 특정 사용자에게 FCM 푸시 알림 전송
 * @param {string} uid - 대상 사용자 UID
 * @param {object} notification - { title, body }
 * @param {object} data - 추가 데이터
 */
async function sendPushToUser(uid, notification, data = {}) {
    try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return;

        const { fcmToken } = userDoc.data();
        if (!fcmToken) return;

        // data.link가 있으면 커스텀 URL 사용, 없으면 기본 URL
        const clickUrl = data.link || "https://vehicle-drive-log.web.app";
        // link는 FCM data payload에서 제거 (fcmOptions에서 사용)
        const { link, ...restData } = data;

        await getMessaging().send({
            token: fcmToken,
            notification,
            data: { ...restData, click_action: clickUrl },
            android: {
                priority: "high",
                notification: {
                    channelId: "vehicle_drive_log_default",
                    priority: "high",
                    defaultSound: true,
                    defaultVibrateTimings: true,
                },
            },
            webpush: {
                headers: { Urgency: "high" },
                fcmOptions: { link: clickUrl },
                notification: {
                    requireInteraction: true,
                    vibrate: [200, 100, 200],
                },
            },
        });

        console.log(`Push sent to ${uid}: ${notification.title}`);
    } catch (err) {
        // 만료된 토큰이면 삭제
        if (err.code === "messaging/registration-token-not-registered") {
            await db.collection("users").doc(uid).update({ fcmToken: null });
            console.log(`Expired token removed for ${uid}`);
        } else {
            console.error(`Push failed for ${uid}:`, err.message);
        }
    }
}

/**
 * 기관의 모든 사용자에게 알림 전송
 * @param {string} orgId - 기관 ID
 * @param {object} notification - { title, body }
 * @param {string} excludeUid - 제외할 사용자 UID (알림 발생자)
 */
async function sendPushToOrg(orgId, notification, excludeUid = null) {
    const membersSnap = await db
        .collection("users")
        .where("organizationId", "==", orgId)
        .get();

    const promises = [];
    membersSnap.forEach((doc) => {
        if (doc.id !== excludeUid) {
            promises.push(sendPushToUser(doc.id, notification));
        }
    });

    await Promise.allSettled(promises);
}

/**
 * Firestore 앱 내 알림 생성
 * @param {string} targetUid - 수신자 UID
 * @param {string} type - 알림 유형 (reservation_cancelled | reservation_changed | admin_notice | approval | rejection | info)
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 내용
 * @param {string} organizationId - 기관 ID
 */
async function createInAppNotification(targetUid, type, title, message, organizationId) {
    await db.collection("notifications").add({
        targetUid,
        type,
        title,
        message,
        organizationId: organizationId || "",
        read: false,
        createdAt: new Date(),
    });
}

/**
 * 기관 전체 사용자에게 앱 내 알림 생성
 * @param {string} orgId - 기관 ID
 * @param {string} type - 알림 유형
 * @param {string} title - 제목
 * @param {string} message - 내용
 * @param {string} excludeUid - 제외할 UID
 */
async function createInAppNotificationForOrg(orgId, type, title, message, excludeUid = null) {
    const membersSnap = await db
        .collection("users")
        .where("organizationId", "==", orgId)
        .get();

    const batch = db.batch();
    membersSnap.forEach((userDoc) => {
        if (userDoc.id !== excludeUid) {
            const ref = db.collection("notifications").doc();
            batch.set(ref, {
                targetUid: userDoc.id,
                type,
                title,
                message,
                organizationId: orgId,
                read: false,
                createdAt: new Date(),
            });
        }
    });

    await batch.commit();
}

module.exports = { sendPushToUser, sendPushToOrg, createInAppNotification, createInAppNotificationForOrg };
