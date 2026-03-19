import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const db = getFirestore();

interface Notification {
    title: string;
    body: string;
}

interface PushData {
    link?: string;
    [key: string]: string | undefined;
}

/**
 * 특정 사용자에게 FCM 푸시 알림 전송
 */
export async function sendPushToUser(uid: string, notification: Notification, data: PushData = {}): Promise<void> {
    try {
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return;

        const { fcmToken } = userDoc.data() as { fcmToken?: string };
        if (!fcmToken) return;

        // data.link가 있으면 커스텀 URL 사용, 없으면 기본 URL
        const clickUrl = data.link || "https://vehicle-drive-log.web.app";
        // link는 FCM data payload에서 제거 (fcmOptions에서 사용)
        const { link, ...restData } = data;

        await getMessaging().send({
            token: fcmToken,
            notification,
            data: { ...restData, click_action: clickUrl } as Record<string, string>,
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
    } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        // 만료된 토큰이면 삭제
        if (error.code === "messaging/registration-token-not-registered") {
            await db.collection("users").doc(uid).update({ fcmToken: null });
            console.log(`Expired token removed for ${uid}`);
        } else {
            console.error(`Push failed for ${uid}:`, error.message);
        }
    }
}

/**
 * 기관의 모든 사용자에게 알림 전송
 */
export async function sendPushToOrg(orgId: string, notification: Notification, excludeUid: string | null = null): Promise<void> {
    const membersSnap = await db
        .collection("users")
        .where("organizationId", "==", orgId)
        .get();

    const promises: Promise<void>[] = [];
    membersSnap.forEach((doc) => {
        if (doc.id !== excludeUid) {
            promises.push(sendPushToUser(doc.id, notification));
        }
    });

    await Promise.allSettled(promises);
}

/**
 * Firestore 앱 내 알림 생성
 */
export async function createInAppNotification(targetUid: string, type: string, title: string, message: string, organizationId?: string): Promise<void> {
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
 */
export async function createInAppNotificationForOrg(orgId: string, type: string, title: string, message: string, excludeUid: string | null = null): Promise<void> {
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
