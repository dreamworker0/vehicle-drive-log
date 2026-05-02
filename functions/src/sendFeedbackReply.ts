/**
 * sendFeedbackReply — 슈퍼관리자가 피드백에 답변을 발송
 *
 * onCall 함수 (슈퍼관리자 전용).
 * 답변을 Firestore에 저장하고, 질문자에게 FCM 푸시 + 앱 내 알림을 발송한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { sendPushToUser, createInAppNotification } from "./sendNotification";

const db = getFirestore();

export const sendFeedbackReply = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 30,
        enforceAppCheck: false,
    },
    async (request) => {
        // 1. 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }

        // 2. superAdmin 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        // 3. 요청 데이터 검증
        const { feedbackId, replyText } = request.data as {
            feedbackId?: string;
            replyText?: string;
        };

        if (!feedbackId || !replyText?.trim()) {
            throw new HttpsError("invalid-argument", "feedbackId와 replyText가 필요합니다.");
        }

        // 4. 피드백 문서 조회
        const feedbackRef = db.collection("feedbacks").doc(feedbackId);
        const feedbackDoc = await feedbackRef.get();

        if (!feedbackDoc.exists) {
            throw new HttpsError("not-found", "해당 의견을 찾을 수 없습니다.");
        }

        const feedbackData = feedbackDoc.data()!;

        // 이미 답변 완료된 의견인지 확인
        if (feedbackData.status === "resolved") {
            throw new HttpsError("already-exists", "이미 답변이 발송된 의견입니다.");
        }

        // 5. 답변 저장
        await feedbackRef.update({
            reply: replyText.trim(),
            repliedAt: FieldValue.serverTimestamp(),
            repliedBy: "superAdmin",
            status: "resolved",
        });

        // 6. 질문자에게 알림 발송
        const targetUid = feedbackData.authorUid || feedbackData.uid;
        const orgId = feedbackData.organizationId || "";

        if (targetUid) {
            // 답변 미리보기 (알림에 표시할 짧은 텍스트)
            const previewText = replyText.trim().length > 80
                ? replyText.trim().slice(0, 80) + "..."
                : replyText.trim();

            // FCM 푸시 알림
            await sendPushToUser(targetUid, {
                title: "의견에 답변이 도착했습니다",
                body: previewText,
            });

            // 앱 내 알림 (전체 내용 저장)
            await createInAppNotification(
                targetUid,
                "feedback_reply",
                "의견에 답변이 도착했습니다",
                replyText.trim(),
                orgId
            );

            console.log(`[sendFeedbackReply] 답변 발송 완료: ${feedbackId} → ${targetUid}`);
        } else {
            console.warn(`[sendFeedbackReply] 질문자 UID 없음: ${feedbackId}`);
        }

        return { success: true };
    }
);
