/**
 * sendBulkReminder — 미활성 기관 일괄 알림톡 발송 (D13 규칙 준수: index.ts에서 분리)
 *
 * superAdmin이 호출하면 승인된 기관 중 직원이 0명인 미활성 기관에
 * 카카오 알림톡 리마인드를 일괄 발송한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { sendReminderAlimtalk } from "../../services/alimtalk/sendAlimtalk";

export const sendBulkReminder = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120, enforceAppCheck: false },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        // superAdmin 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        const db = getFirestore();

        // 승인된 기관 조회
        const orgsSnap = await db.collection("organizations")
            .where("status", "==", "approved")
            .get();

        const results: { orgName: string; phone: string; success: boolean; message?: string }[] = [];
        let sentCount = 0;
        let failCount = 0;
        let noPhoneCount = 0;

        for (const orgDoc of orgsSnap.docs) {
            const org = orgDoc.data();

            // 직원 수 확인 (0명 = 미활성)
            const membersSnap = await db.collection("users")
                .where("organizationId", "==", orgDoc.id)
                .limit(1)
                .get();

            if (!membersSnap.empty) continue; // 직원이 있으면 건너뛰기

            // 전화번호 확인
            const phone = org.applicantPhone || org.phone;
            if (!phone) {
                noPhoneCount++;
                results.push({ orgName: org.name, phone: "-", success: false, message: "전화번호 없음" });
                continue;
            }

            // 알림톡 발송
            const name = org.applicantName || org.name;
            const inviteCode = org.inviteCode || "";

            if (!inviteCode) {
                results.push({ orgName: org.name, phone, success: false, message: "초대코드 없음" });
                failCount++;
                continue;
            }

            const result = await sendReminderAlimtalk(phone, name, org.name, inviteCode);

            if (result.success) {
                sentCount++;
            } else {
                failCount++;
            }

            results.push({
                orgName: org.name,
                phone,
                success: result.success,
                message: result.message,
            });
        }

        console.log(`[BulkReminder] 완료: 성공 ${sentCount}, 실패 ${failCount}, 번호없음 ${noPhoneCount}`);

        return { sentCount, failCount, noPhoneCount, results };
    }
);
