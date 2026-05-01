/**
 * emailService — 기관 승인 이메일 발송
 *
 * 보안을 위해 서버사이드(Cloud Function)에서 이메일을 발송한다.
 * 프론트엔드에서 EmailJS 키를 노출하지 않는다.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * 기관 승인 이메일 발송 (Cloud Function 호출)
 * @param recipientEmail 수신자 이메일
 * @param orgName 기관명
 * @param inviteCode 초대 코드
 * @param applicantName 신청자 이름
 * @returns 발송 성공 여부
 */
export const sendApprovalEmail = async (recipientEmail: string, orgName: string, inviteCode: string, applicantName?: string) => {
    try {
        const functions = getFunctions(undefined, 'asia-northeast3');
        const sendEmail = httpsCallable(functions, 'sendApprovalEmail');

        const result = await sendEmail({
            recipientEmail,
            orgName,
            inviteCode,
            applicantName,
        });

        console.debug('✅ 승인 이메일 발송 성공 (Cloud Function):', result.data);
        return true;
    } catch (err) {
        console.error('❌ 승인 이메일 발송 실패:', err);
        throw err;
    }
};
