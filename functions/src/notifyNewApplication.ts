/**
 * notifyNewApplication — 기관 신청 시 슈퍼관리자에게 이메일 알림
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as nodemailer from "nodemailer";

function createTransporter() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

export const notifyNewApplication = onDocumentCreated(
    "organizations/{orgId}",
    async (event) => {
        const data = event.data!.data();
        const orgId = event.params.orgId;

        if (data.status !== "pending") {
            return;
        }

        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            console.error("GMAIL_USER 또는 GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.");
            return;
        }

        const orgName = (data.name as string) || "이름 없음";
        const applicantName = (data.applicantName as string) || "이름 없음";
        const orgEmail = (data.applicantEmail as string) || "이메일 없음";
        const orgPhone = (data.applicantPhone as string) || "전화번호 없음";
        const appliedAt = data.createdAt
            ? new Date((data.createdAt as { seconds: number }).seconds * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
            : new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

        const adminEmail = "ehsheh@gmail.com";

        const mailOptions = {
            from: `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`,
            to: adminEmail,
            subject: `[차량운행일지] 새 기관 신청: ${orgName}`,
            html: `
                <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                        <h2 style="margin: 0; font-size: 20px;">🏢 새 기관 신청이 접수되었습니다</h2>
                    </div>
                    <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B; width: 100px;">기관명</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #1E293B;">${orgName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B;">신청자</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #1E293B;">${applicantName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B;">이메일</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #1E293B;">${orgEmail}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B;">연락처</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #1E293B;">${orgPhone}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; color: #64748B;">신청일시</td>
                                <td style="padding: 12px 0; color: #1E293B;">${appliedAt}</td>
                            </tr>
                        </table>
                        <div style="margin-top: 20px; text-align: center;">
                            <a href="https://vehicle-drive-log.web.app/super-admin/applications"
                               style="display: inline-block; background: #3B82F6; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                신청 관리 페이지로 이동
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
            console.log(`신청 알림 이메일 전송 완료: org=${orgId}, name=${orgName}, to=${adminEmail}`);
        } catch (err: unknown) {
            console.error("신청 알림 이메일 전송 실패:", (err as Error).message);
        }
    }
);
