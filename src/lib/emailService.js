import emailjs from '@emailjs/browser';

// EmailJS 설정 (.env에서 로드)
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;

const SERVICE_URL = 'https://vehicle-drive-log.web.app';

// EmailJS 초기화
emailjs.init(EMAILJS_PUBLIC_KEY);


/**
 * 기관 승인 이메일 발송
 * @param {string} recipientEmail - 수신자 이메일
 * @param {string} orgName - 기관명
 * @param {string} inviteCode - 기관관리자 초대 코드
 * @returns {Promise<boolean>} 발송 성공 여부
 */
export const sendApprovalEmail = async (recipientEmail, orgName, inviteCode) => {
    try {
        const templateParams = {
            to_email: recipientEmail,
            to_name: orgName,
            name: orgName,
            org_name: orgName,
            invite_code: inviteCode,
            service_url: SERVICE_URL,
        };

        console.log('📧 이메일 발송 시도:', JSON.stringify(templateParams));
        console.log('📧 EmailJS 설정:', { serviceId: EMAILJS_SERVICE_ID, templateId: EMAILJS_TEMPLATE_ID });

        const response = await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams
        );

        console.log('✅ 승인 이메일 발송 성공:', response.status, response.text);
        return true;
    } catch (err) {
        console.error('❌ 승인 이메일 발송 실패:', err);
        console.error('❌ 에러 상세:', typeof err === 'object' ? JSON.stringify(err, Object.getOwnPropertyNames(err)) : err);
        throw err; // 호출자에게 에러를 전파하여 디버깅 가능
    }
};
