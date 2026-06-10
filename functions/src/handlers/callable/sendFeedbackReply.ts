/**
 * sendFeedbackReply — 슈퍼관리자가 피드백에 답변을 발송
 *
 * onCall 함수 (슈퍼관리자 전용).
 * 답변을 Firestore에 저장하고, 질문자에게 FCM 푸시 + 앱 내 알림 및 이메일을 발송한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";
import * as nodemailer from "nodemailer";

const db = getFirestore();

function createTransporter() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

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

        // 6. 질문자에게 알림 발송 (앱 내 알림 + FCM)
        const targetUid = feedbackData.authorUid || feedbackData.uid;
        const orgId = feedbackData.organizationId || "";
        const targetEmail = feedbackData.userEmail || feedbackData.authorEmail;

        if (targetUid && targetUid !== "public-inquiry") {
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

            console.log(`[sendFeedbackReply] 앱 내 알림 발송 완료: ${feedbackId} → ${targetUid}`);
        } else {
            console.warn(`[sendFeedbackReply] 앱 내 알림 대상 아님 (UID 없음 또는 비회원): ${feedbackId}`);
        }

        // 7. 이메일 알림 발송 (이메일 정보가 있는 경우)
        if (targetEmail) {
            try {
                if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
                    console.warn("[sendFeedbackReply] GMAIL 환경변수 누락으로 이메일 발송 생략");
                } else {
                    const transporter = createTransporter();
                    const mailOptions = {
                        from: `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`,
                        to: targetEmail,
                        subject: `[차량운행일지] 접수하신 문의/의견에 답변이 등록되었습니다.`,
                        html: `
                            <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                <div style="background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                                    <h2 style="margin: 0; font-size: 20px;">💬 문의하신 내용에 답변이 등록되었습니다</h2>
                                </div>
                                <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                                    <p style="color: #1E293B; font-size: 16px;">안녕하세요, <strong>${feedbackData.userName || '사용자'}</strong>님.</p>
                                    <p style="color: #475569;">차량운행일지에 남겨주신 소중한 의견에 대해 관리자의 답변이 등록되었습니다.</p>
                                    
                                    <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                                        <p style="color: #64748B; font-size: 14px; margin: 0 0 8px; font-weight: bold;">관리자 답변</p>
                                        <p style="color: #1E293B; font-size: 15px; margin: 0; white-space: pre-wrap;">${replyText.trim()}</p>
                                    </div>

                                    <p style="color: #475569; font-size: 14px;">본 서비스 발전을 위해 남겨주신 의견에 깊이 감사드립니다.</p>
                                </div>
                                <p style="text-align: center; color: #94A3B8; font-size: 12px; margin-top: 16px;">
                                    이 메일은 차량운행일지 시스템에서 자동 발송되었습니다.
                                </p>
                            </div>
                        `,
                    };
                    await transporter.sendMail(mailOptions);
                    console.log(`[sendFeedbackReply] 이메일 발송 완료: ${feedbackId}`);
                }
            } catch (err: unknown) {
                console.error("[sendFeedbackReply] 이메일 발송 실패:", (err as Error).message);
                // 이메일 전송 실패가 전체 트랜잭션을 중단하지 않도록 에러만 로깅
            }
        }

        return { success: true };
    }
);
