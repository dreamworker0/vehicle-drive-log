/**
 * sendManualRejectionAlimtalk — 기관 신청 반려 시 알림톡 발송 (Callable Cloud Function)
 *
 * 프론트엔드에서 관리자가 반려 버튼을 누를 때, 반려 이메일과 함께 호출됩니다.
 * 서버 환경변수(ALIMTALK_PROXY_URL/TOKEN)를 사용하여 알림톡을 발송합니다.
 */
import { onCall } from "firebase-functions/v2/https";
import { sendRejectionAlimtalk } from "../../services/alimtalk/sendAlimtalk";
import { loadOrgForManualAlimtalk } from "../../services/alimtalk/manualSendHelpers";
import { requireSuperAdmin } from "../../utils/helpers";
import { getKSTDateString } from "../../utils/kstDate";

export const sendManualRejectionAlimtalk = onCall(
    { region: "asia-northeast3", enforceAppCheck: false },
    async (request) => {
        requireSuperAdmin(request);

        const { orgId, reason } = request.data as { orgId: string; reason?: string };
        const { org, phone, name, orgName } = await loadOrgForManualAlimtalk(orgId);

        if (!phone) {
            console.warn(`[ManualRejection] 전화번호 없음: ${orgName} (${orgId})`);
            return { success: false, message: "신청자 전화번호가 없습니다." };
        }

        // 신청 일자 (createdAt → KST 'YYYY-MM-DD')
        const createdAt = org.createdAt?.toDate ? org.createdAt.toDate() : new Date();
        const applicationDate = getKSTDateString(createdAt);

        console.log(`[ManualRejection] 반려 알림톡 발송 시작: ${orgName} (${orgId})`);
        const result = await sendRejectionAlimtalk(
            phone,
            name,
            orgName,
            applicationDate,
            reason || "자세한 사유는 안내 이메일을 확인해 주세요.",
        );

        return {
            success: result.success,
            message: result.message,
        };
    }
);
