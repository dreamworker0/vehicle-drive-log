import { getFirestore, FieldValue } from "firebase-admin/firestore";
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

        // ## data-only로 보낸다 (표시·클릭 모두 서비스 워커가 맡는다)
        //
        // `notification`·`webpush.notification`·`webpush.fcmOptions.link` 중 하나라도 실리면
        // FCM SDK가 알림을 자동 표시하고 **클릭도 SDK 기본 핸들러가 가져간다.** 그러면
        // 서비스 워커가 정한 '어느 탭을 움직일지' 규칙이 통째로 우회된다 — 보고 있지 않던
        // 탭이 끌려가는 문제를 고쳐 놓고도 정작 서버발 알림에는 적용되지 않던 이유다.
        //
        // 제목·본문은 data로 옮긴다. 표시 옵션(requireInteraction·vibrate)과 클릭 처리는
        // public/firebase-messaging-sw.template.js가 담당한다.
        // ⚠️ 이 앱은 웹(PWA) 전용이라 android.notification은 쓰지 않는다. 네이티브 앱을
        //    붙이게 되면 그때는 android/apns 표시 필드를 다시 검토해야 한다.
        await getMessaging().send({
            token: fcmToken,
            data: {
                ...restData,
                title: notification.title,
                body: notification.body,
                click_action: clickUrl,
            } as Record<string, string>,
            android: { priority: "high" },
            webpush: {
                headers: { Urgency: "high" },
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
        createdAt: FieldValue.serverTimestamp(),
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
                createdAt: FieldValue.serverTimestamp(),
            });
        }
    });

    await batch.commit();
}
