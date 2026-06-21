/**
 * notifyNewApplication — 기관 신청 시 슈퍼관리자에게 이메일 알림 및 디스코드 알림
 */
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as nodemailer from "nodemailer";
import { sendDiscordAlert } from "../../core/discord";

function createTransporter() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

export const notifyNewApplication = onDocumentWritten(
    "organizations/{orgId}",
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        
        if (!after) return; // 데이터가 완전히 삭제된 경우 무시

        const orgId = event.params.orgId;
        const orgName = (after.name as string) || "이름 없음";
        const applicantName = (after.applicantName as string) || "이름 없음";
        const orgEmail = (after.applicantEmail as string) || "이메일 없음";
        const orgPhone = (after.applicantPhone as string) || "전화번호 없음";

        const isNewApplication = (!before && after.status === "pending") || (before?.status !== "pending" && after.status === "pending");
        const isRejected = before?.status !== "rejected" && after.status === "rejected";
        const isApproved = before?.status !== "approved" && after.status === "approved";

        // 1. 신규 기관 신청
        if (isNewApplication) {
            // 디스코드 알림
            await sendDiscordAlert({
                title: `🏢 🆕 새 기관 신청 접수`,
                description: `**${orgName}** (이름: ${applicantName}) 기관이 사용 신청을 했습니다. 관리자 대시보드에서 승인을 진행해주세요.`,
                color: 3447003, // 파란색 계열
                fields: [
                    { name: "신청자 연락처", value: orgPhone, inline: true },
                    { name: "기관 이메일", value: orgEmail, inline: true }
                ]
            }).catch(e => console.error("Discord alert error:", e));

            // 기존 이메일 알림 로직
            if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
                console.error("GMAIL_USER 또는 GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.");
                return;
            }

            const appliedAt = after.createdAt
                ? new Date((after.createdAt as { seconds: number }).seconds * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
                : new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

            // 수신자는 환경변수로 관리 (미설정 시 발신 계정으로 수신)
            const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;

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
                console.log(`신청 알림 이메일 전송 완료: org=${orgId}, name=${orgName}`);
            } catch (err: unknown) {
                console.error("신청 알림 이메일 전송 실패:", (err as Error).message);
            }
        } 
        
        // 2. 기관 승인 보류(거절) 알림
        else if (isRejected) {
            // (autoVerifyDocument.ts 등의 AI 검증 사유 혹은 관리자의 수동 입력 사유)
            const aiDetail = after.aiVerifyDetail as Record<string, unknown> | undefined;
            const reason = (aiDetail?.reason as string | undefined) || "알수없는 사유 또는 수동 반려";
            
            await sendDiscordAlert({
                title: `⛔ 🏢 기관 신청 보류(거절)`,
                description: `**${orgName}** 기관의 가입 신청이 보류되었습니다.\n\n**사유**: ${reason}`,
                color: 15158332, // 빨간색 계열
                fields: [
                    { name: "신청자", value: applicantName, inline: true }
                ]
            }).catch(e => console.error("Discord alert error:", e));
        }

        // 3. 기관 승인 완료 알림
        else if (isApproved) {
            await sendDiscordAlert({
                title: `🎉 🏢 기관 가입 승인 완료`,
                description: `**${orgName}** 기관이 성공적으로 계정을 발급받았습니다.`,
                color: 5763719, // 녹색 계열 (Success)
                fields: [
                    { name: "신청자", value: applicantName, inline: true }
                ]
            }).catch(e => console.error("Discord alert error:", e));
        }
    }
);
