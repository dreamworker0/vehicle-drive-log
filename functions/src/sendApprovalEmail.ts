/**
 * sendApprovalEmail — 기관 승인 시 이메일 발송 (서버사이드)
 *
 * 프론트엔드 EmailJS 키 노출을 방지하기 위해 Cloud Function으로 이전.
 * notifyNewApplication.ts의 nodemailer/Gmail SMTP 패턴을 재활용한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";
import { checkRateLimitByUid } from "./rateLimit";
import { RATE_LIMITS } from "./constants";

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

export const sendApprovalEmail = onCall(
    { region: "asia-northeast3", enforceAppCheck: true },
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
            "sendApprovalEmail",
            request.auth.uid,
            RATE_LIMITS.sendApprovalEmail.max,
            RATE_LIMITS.sendApprovalEmail.windowSec
        );

        // 파라미터 검증
        const { recipientEmail, orgName, inviteCode, applicantName } = request.data;
        if (!recipientEmail || !orgName || !inviteCode) {
            throw new HttpsError("invalid-argument", "recipientEmail, orgName, inviteCode는 필수입니다.");
        }

        // Gmail 환경변수 확인
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            console.error("GMAIL_USER 또는 GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.");
            throw new HttpsError("internal", "이메일 발송 설정이 완료되지 않았습니다.");
        }

        const displayName = applicantName || orgName;
        const serviceUrl = `${SERVICE_URL}?code=${inviteCode}`;

        const mailOptions = {
            from: `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`,
            to: recipientEmail,
            subject: `[차량운행일지] ${orgName} 기관 승인 완료`,
            html: `
                <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                        <h2 style="margin: 0; font-size: 20px;">✅ 기관 승인이 완료되었습니다</h2>
                    </div>
                    <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                        <p style="color: #1E293B; font-size: 16px;">안녕하세요, <strong>${displayName}</strong>님!</p>
                        <p style="color: #475569;"><strong>${orgName}</strong> 기관의 신청이 승인되었습니다.</p>
                        <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
                            <p style="color: #64748B; font-size: 14px; margin: 0 0 8px;">초대 코드</p>
                            <p style="color: #1E293B; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 2px;">${inviteCode}</p>
                        </div>
                        <p style="color: #475569; font-size: 14px;">위 초대 코드를 직원들에게 공유하여 기관에 가입하도록 안내해 주세요.</p>
                        <div style="margin-top: 20px; text-align: center;">
                            <a href="${serviceUrl}"
                               style="display: inline-block; background: #3B82F6; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                서비스 바로가기
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
            console.log(`승인 이메일 전송 완료: to=${recipientEmail}, org=${orgName}`);
            return { success: true };
        } catch (err: unknown) {
            console.error("승인 이메일 전송 실패:", (err as Error).message);
            throw new HttpsError("internal", "이메일 발송에 실패했습니다.");
        }
    }
);
