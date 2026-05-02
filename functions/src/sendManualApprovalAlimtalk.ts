/**
 * sendManualApprovalAlimtalk — 수동 승인 시 알림톡 발송 (Callable Cloud Function)
 *
 * 프론트엔드에서 관리자가 수동 승인 버튼을 누를 때 호출됩니다.
 * 서버 환경변수(ALIMTALK_PROXY_URL/TOKEN)를 사용하여 알림톡을 발송합니다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendApprovalAlimtalk } from "./sendAlimtalk";

export const sendManualApprovalAlimtalk = onCall(
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

        const { orgId } = request.data as { orgId: string };
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
        const centerName = org.name;
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
