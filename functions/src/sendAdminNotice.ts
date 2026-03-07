/**
 * sendAdminNotice — 기관 소속 사용자가 전체에게 공지사항 전송
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendPushToOrg, createInAppNotificationForOrg } from "./sendNotification";

const db = getFirestore();

export const sendAdminNotice = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const uid = request.auth.uid;
        const { orgId, title, message } = request.data;

        if (!orgId || !title || !message) {
            throw new HttpsError("invalid-argument", "orgId, title, message는 필수입니다.");
        }

        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            throw new HttpsError("permission-denied", "사용자를 찾을 수 없습니다.");
        }

        const userData = userDoc.data()!;
        if (!["superAdmin", "admin", "employee"].includes(userData.role as string)) {
            throw new HttpsError("permission-denied", "기관 소속 사용자만 공지를 보낼 수 있습니다.");
        }

        if (userData.organizationId !== orgId) {
            throw new HttpsError("permission-denied", "자기 기관에만 공지를 보낼 수 있습니다.");
        }

        try {
            const senderName = (userData.name as string) || (userData.email as string) || "관리자";

            await createInAppNotificationForOrg(
                orgId,
                "admin_notice",
                title,
                `${senderName}: ${message}`,
                null
            );

            await sendPushToOrg(
                orgId,
                {
                    title: `공지: ${title}`,
                    body: message,
                },
                uid
            );

            console.log(`Admin notice sent: org=${orgId}, title="${title}", by=${senderName}`);
            return { success: true };
        } catch (err: unknown) {
            console.error("Admin notice failed:", (err as Error).message);
            throw new HttpsError("internal", "공지 전송에 실패했습니다.");
        }
    }
);
