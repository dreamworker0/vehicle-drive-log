/**
 * withdrawOrganization — 기관 자발적 서비스 해지 (관리자용)
 * onCall 함수: 기관 관리자가 직접 서비스를 해지(탈퇴)할 때 호출
 * 소속 직원 user 문서를 일괄 삭제하고 기관을 soft delete(30일 복구 가능) 처리한다.
 * 사유(deletedBy='admin' + withdrawReason)를 기록해 슈퍼관리자가 이탈을 통계로 확인할 수 있게 한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const WITHDRAW_REASONS = ["no_longer_needed", "too_difficult", "missing_features", "other"] as const;
type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

export const withdrawOrganization = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { organizationId, reason, reasonDetail } = request.data ?? {};
        if (!organizationId || typeof organizationId !== "string") {
            throw new HttpsError("invalid-argument", "기관 ID가 필요합니다.");
        }
        if (!reason || !WITHDRAW_REASONS.includes(reason as WithdrawReason)) {
            throw new HttpsError("invalid-argument", "유효한 탈퇴 사유가 필요합니다.");
        }

        const db = getFirestore();

        try {
            // 1. 호출자가 해당 기관의 관리자(admin)인지 검증 (다른 기관 탈퇴 차단)
            const callerDoc = await db.collection("users").doc(request.auth.uid).get();
            const caller = callerDoc.data();
            if (!callerDoc.exists || caller?.role !== "admin") {
                throw new HttpsError("permission-denied", "기관 관리자만 서비스를 해지할 수 있습니다.");
            }
            if (caller?.organizationId !== organizationId) {
                throw new HttpsError("permission-denied", "다른 기관은 해지할 수 없습니다.");
            }

            // 2. 기관 존재 + 상태 확인
            const orgRef = db.collection("organizations").doc(organizationId);
            const orgSnap = await orgRef.get();
            if (!orgSnap.exists) {
                throw new HttpsError("not-found", "기관을 찾을 수 없습니다.");
            }
            if (orgSnap.data()?.status === "deleted") {
                throw new HttpsError("failed-precondition", "이미 해지된 기관입니다.");
            }

            // 3. 소속 직원 문서 일괄 삭제 + 기관 soft delete (Admin SDK라 Rules 우회)
            const usersSnap = await db
                .collection("users")
                .where("organizationId", "==", organizationId)
                .get();

            const batch = db.batch();
            usersSnap.docs.forEach((userDoc) => batch.delete(userDoc.ref));

            const orgUpdate: Record<string, unknown> = {
                status: "deleted",
                deletedAt: FieldValue.serverTimestamp(),
                deletedBy: "admin",
                withdrawReason: reason,
            };
            if (reason === "other" && typeof reasonDetail === "string" && reasonDetail.trim()) {
                orgUpdate.withdrawReasonDetail = reasonDetail.trim().slice(0, 500);
            }
            batch.update(orgRef, orgUpdate);

            await batch.commit();

            // 이미 발급된 로그인 토큰을 바로 무효화한다. users 문서 삭제로 권한 클레임은 비워지지만
            // (setCustomClaims), 발급된 ID 토큰은 만료(최대 1시간)까지 옛 기관 권한을 그대로 들고 있다.
            // 실패해도 해지는 진행한다 — 토큰은 1시간 안에 스스로 만료된다.
            const revoked = await Promise.allSettled(
                usersSnap.docs.map((userDoc) => getAuth().revokeRefreshTokens(userDoc.id)),
            );
            const revokeFailed = revoked.filter((r) => r.status === "rejected").length;
            if (revokeFailed > 0) {
                console.warn(`기관 해지: 토큰 무효화 ${revokeFailed}/${usersSnap.size}건 실패 (${organizationId})`);
            }

            console.log(
                `기관 서비스 해지 완료: ${organizationId} (사유: ${reason}, 호출자: ${request.auth.uid}, 직원 ${usersSnap.size}명 정리)`
            );
            return { success: true };
        } catch (err: unknown) {
            console.error("기관 서비스 해지 실패:", (err as Error).message);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "서비스 해지 중 오류가 발생했습니다.");
        }
    }
);
