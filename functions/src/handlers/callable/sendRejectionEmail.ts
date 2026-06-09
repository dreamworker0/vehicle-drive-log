/**
 * sendRejectionEmail — 기관 신청 반려 시 이메일 발송 (서버사이드)
 *
 * 프론트엔드 EmailJS 키 노출을 방지하기 위해 Cloud Function으로 구현.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { RATE_LIMITS } from "../../utils/constants";

const SERVICE_URL = "https://vehicle-drive-log.web.app";

function createTransporter() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

export const sendRejectionEmail = onCall(
    { region: "asia-northeast3", enforceAppCheck: false },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        // superAdmin 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        // Rate Limiting
        await checkRateLimitByUid(
            "sendRejectionEmail",
            request.auth.uid,
            RATE_LIMITS.sendApprovalEmail.max, // 기존 Rate limit 설정을 재사용 (동일한 이메일 발송 트래픽 기준)
            RATE_LIMITS.sendApprovalEmail.windowSec
        );

        // 파라미터 검증
        const { recipientEmail, orgName, applicantName, reason } = request.data;
        if (!recipientEmail || !orgName) {
            throw new HttpsError("invalid-argument", "recipientEmail, orgName은 필수입니다.");
        }

        // Gmail 환경변수 확인
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            console.error("GMAIL_USER 또는 GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.");
            throw new HttpsError("internal", "이메일 발송 설정이 완료되지 않았습니다.");
        }

        const displayName = applicantName || orgName;
        const rejectionReasonHtml = reason 
            ? `<div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="color: #64748B; font-size: 14px; margin: 0 0 8px; font-weight: bold;">거절 사유</p>
                <p style="color: #1E293B; font-size: 15px; margin: 0; white-space: pre-wrap;">${reason}</p>
               </div>` 
            : ``;

        const mailOptions = {
            from: `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`,
            to: recipientEmail,
            subject: `[차량운행일지] ${orgName} 기관 신청 반려 안내`,
            html: `
                <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #EF4444, #DC2626); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                        <h2 style="margin: 0; font-size: 20px;">⚠️ 기관 신청이 반려되었습니다</h2>
                    </div>
                    <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                        <p style="color: #1E293B; font-size: 16px;">안녕하세요, <strong>${displayName}</strong>님.</p>
                        <p style="color: #475569;">신청해주신 <strong>${orgName}</strong> 기관의 가입 신청이 검토 결과 아쉽게도 반려되었습니다.</p>
                        
                        ${rejectionReasonHtml}

                        <p style="color: #475569; font-size: 14px;">본 서비스는 비영리 단체를 대상으로 제공되고 있으며, 제출해주신 증빙서류를 다시 한번 확인해 주시기 바랍니다.</p>
                        <p style="color: #475569; font-size: 14px;">서류 보완 후 홈페이지에서 다시 신청하실 수 있습니다.</p>
                        <div style="margin-top: 20px; text-align: center;">
                            <a href="${SERVICE_URL}"
                               style="display: inline-block; background: #EF4444; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                서비스로 돌아가기
                            </a>
                        </div>
                    </div>
                    <p style="text-align: center; color: #94A3B8; font-size: 12px; margin-top: 16px;">
                        이 메일은 차량운행일지 시스템에서 자동 발송되었습니다.
                    </p>
                </div>
            `,
        };

        try {
            const transporter = createTransporter();
            await transporter.sendMail(mailOptions);
            console.log(`반려 이메일 전송 완료: to=${recipientEmail}, org=${orgName}`);
            return { success: true };
        } catch (err: unknown) {
            console.error("반려 이메일 전송 실패:", (err as Error).message);
            throw new HttpsError("internal", "이메일 발송에 실패했습니다.");
        }
    }
);
