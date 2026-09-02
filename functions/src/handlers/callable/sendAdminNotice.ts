/**
 * sendAdminNotice — 기관 소속 사용자가 전체에게 공지사항 전송
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendPushToOrg, createInAppNotificationForOrg } from "../../services/alimtalk/sendNotification";
import { checkRateLimitByUid } from "../../utils/rateLimit";

const db = getFirestore();

/** 제목·내용 길이 상한 — 화면(AdminNotice.tsx)의 maxLength와 같은 값 */
export const TITLE_MAX_LENGTH = 100;
export const MESSAGE_MAX_LENGTH = 500;

// 4차 배치(2026-07-25): 기관 전체 FCM 팬아웃이라 남용이 곧 과금·스팸이다.
// 호출부는 인증된 관리자 화면(AdminNotice.tsx)뿐이라 토큰을 항상 기대할 수 있다.
export const sendAdminNotice = onCall(
    { region: "asia-northeast3", enforceAppCheck: true },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const uid = request.auth.uid;

        // Rate Limiting: 사용자당 시간당 20회 (스팸 방지)
        await checkRateLimitByUid("sendAdminNotice", uid, 20, 3600);

        const { orgId, title, message } = request.data;

        if (!orgId || !title || !message) {
            throw new HttpsError("invalid-argument", "orgId, title, message는 필수입니다.");
        }
        // 기관 전체에 푸시로 나가는 문구라 길이 상한을 둔다 — 화면(AdminNotice.tsx)도 같은 값으로 막지만
        // 콜러블은 화면을 우회해 부를 수 있다. FCM 알림 본문 4KB 제한보다 훨씬 안쪽이다.
        if (typeof title !== "string" || typeof message !== "string"
            || title.length > TITLE_MAX_LENGTH || message.length > MESSAGE_MAX_LENGTH) {
            throw new HttpsError("invalid-argument", `제목은 ${TITLE_MAX_LENGTH}자, 내용은 ${MESSAGE_MAX_LENGTH}자 이내여야 합니다.`);
        }

        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            throw new HttpsError("permission-denied", "사용자를 찾을 수 없습니다.");
        }

        const userData = userDoc.data()!;
        // 관리자만. 종전에는 employee도 통과시켜 로그인한 직원 누구나 기관 전체에 푸시를 보낼 수 있었다
        // (2026-09-02 보안 점검). 호출 화면(AdminNotice.tsx)은 관리자 전용이므로 동작 변화는 없다.
        if (!["superAdmin", "admin"].includes(userData.role as string)) {
            throw new HttpsError("permission-denied", "기관 관리자만 공지를 보낼 수 있습니다.");
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
