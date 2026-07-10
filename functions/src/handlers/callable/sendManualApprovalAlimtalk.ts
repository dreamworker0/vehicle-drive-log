/**
 * sendManualApprovalAlimtalk — 수동 승인 시 알림톡 발송 (Callable Cloud Function)
 *
 * 프론트엔드에서 관리자가 수동 승인 버튼을 누를 때 호출됩니다.
 * 서버 환경변수(ALIMTALK_PROXY_URL/TOKEN)를 사용하여 알림톡을 발송합니다.
 */
import { onCall } from "firebase-functions/v2/https";
import { sendApprovalAlimtalk } from "../../services/alimtalk/sendAlimtalk";
import { loadOrgForManualAlimtalk } from "../../services/alimtalk/manualSendHelpers";
import { requireSuperAdmin } from "../../utils/helpers";
import { ALIMTALK_PROXY_TOKEN } from "../../core/params";

export const sendManualApprovalAlimtalk = onCall(
    { region: "asia-northeast3", enforceAppCheck: false, secrets: [ALIMTALK_PROXY_TOKEN] },
    async (request) => {
        requireSuperAdmin(request);

        const { orgId } = request.data as { orgId: string };
        const { org, phone, name, orgName: centerName } = await loadOrgForManualAlimtalk(orgId);
        const inviteCode = org.inviteCode;

        if (!phone) {
            console.warn(`[ManualApproval] 전화번호 없음: ${centerName} (${orgId})`);
            return { success: false, message: "신청자 전화번호가 없습니다." };
        }

        if (!inviteCode) {
            console.warn(`[ManualApproval] 초대코드 없음: ${centerName} (${orgId})`);
            return { success: false, message: "초대코드가 없습니다." };
        }

        console.log(`[ManualApproval] 알림톡 발송 시작: ${centerName} (${orgId})`);
        const result = await sendApprovalAlimtalk(phone, name, centerName, inviteCode);

        return {
            success: result.success,
            message: result.message,
        };
    }
);
