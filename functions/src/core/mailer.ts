/**
 * mailer — Gmail SMTP 발송 공통 헬퍼
 *
 * createTransporter가 이메일 발송 파일 5곳에 동일하게 복붙되어 있던 것을 단일화.
 * GMAIL 계정/전송 방식 변경 시 이 파일만 수정하면 된다.
 */
import * as nodemailer from "nodemailer";

/** GMAIL 발송 환경변수(GMAIL_USER/GMAIL_APP_PASSWORD)가 설정되어 있는지 */
export function isGmailConfigured(): boolean {
    return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** Gmail SMTP transporter 생성 */
export function createGmailTransporter() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

/** 시스템 발신자 표기 (환경변수는 호출 시점에 읽는다) */
export function systemMailFrom(): string {
    return `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`;
}
