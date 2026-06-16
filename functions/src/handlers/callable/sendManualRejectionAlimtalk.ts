/**
 * sendManualRejectionAlimtalk — 기관 신청 반려 시 알림톡 발송 (Callable Cloud Function)
 *
 * 프론트엔드에서 관리자가 반려 버튼을 누를 때, 반려 이메일과 함께 호출됩니다.
 * 서버 환경변수(ALIMTALK_PROXY_URL/TOKEN)를 사용하여 알림톡을 발송합니다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendRejectionAlimtalk } from "../../services/alimtalk/sendAlimtalk";
import { getKSTDateString } from "../../utils/kstDate";

export const sendManualRejectionAlimtalk = onCall(
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

        const { orgId, reason } = request.data as { orgId: string; reason?: string };
        if (!orgId) {
            throw new HttpsError("invalid-argument", "orgId가 필요합니다.");
        }

        const db = getFirestore();
        const orgDoc = await db.doc(`organizations/${orgId}`).get();

        if (!orgDoc.exists) {
            throw new HttpsError("not-found", "기관을 찾을 수 없습니다.");
        }

        const org = orgDoc.data()!;
        const phone = org.applicantPhone;
        const name = org.applicantName || org.name;
        const orgName = org.name;

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
