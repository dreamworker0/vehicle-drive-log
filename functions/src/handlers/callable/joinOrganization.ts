/**
 * joinOrganization — 초대 코드로 기관 가입 (onCall)
 *
 * 클라이언트에서 직접 Firestore를 조작하면 신규 사용자(Custom Claims 없음)가
 * 보안 규칙에 막히므로, Admin SDK로 서버사이드에서 처리한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { RATE_LIMITS } from "../../utils/constants";

const db = getFirestore();

export const joinOrganization = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    async (request) => {
        // 1. 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;

        // Rate Limiting: 사용자당 시간당 5회 (브루트포스 방지)
        await checkRateLimitByUid("joinOrganization", uid, RATE_LIMITS.joinOrganization.max, RATE_LIMITS.joinOrganization.windowSec);
        const displayName = request.auth.token.name || "";
        const signInProvider =
            request.auth.token.firebase?.sign_in_provider || "";

        // 익명 사용자 차단
        if (signInProvider === "anonymous" || !email) {
            throw new HttpsError(
                "failed-precondition",
                "Google 계정으로 로그인 후 다시 시도해주세요."
            );
        }

        // 2. 파라미터 검증
        const { code } = request.data as { code?: string };
        if (!code || code.length !== 6) {
            throw new HttpsError(
                "invalid-argument",
                "6자리 초대 코드를 입력해주세요."
            );
        }

        const upperCode = code.toUpperCase();

        try {
            // 3. 초대 코드로 기관 검색
            const orgSnap = await db
                .collection("organizations")
                .where("inviteCode", "==", upperCode)
                .where("status", "==", "approved")
                .limit(1)
                .get();

            if (orgSnap.empty) {
                throw new HttpsError(
                    "not-found",
                    "유효하지 않은 초대 코드입니다."
                );
            }

            const orgDoc = orgSnap.docs[0];
            const orgId = orgDoc.id;
            const orgData = orgDoc.data();

            // 4. 이미 가입된 사용자인지 확인
            const existingUser = await db
                .collection("users")
                .doc(uid)
                .get();

            // 비활성화된 계정은 재가입으로 상태를 우회할 수 없다.
            // (비활성 사용자가 스스로 organizationId를 비운 뒤 재가입해
            //  status:'disabled'를 덮어써 관리자의 비활성화를 무력화하는 것을 차단)
            if (
                existingUser.exists &&
                existingUser.data()?.status === "disabled"
            ) {
                throw new HttpsError(
                    "permission-denied",
                    "비활성화된 계정입니다. 기관 관리자에게 문의해 주세요."
                );
            }

            if (
                existingUser.exists &&
                existingUser.data()?.organizationId
            ) {
                throw new HttpsError(
                    "already-exists",
                    "이미 기관에 소속되어 있습니다."
                );
            }

            // 5. 기존 멤버 목록에서 이메일 매칭 (이름 가져오기)
            const membersSnap = await db
                .collection("users")
                .where("organizationId", "==", orgId)
                .get();

            const matchedMember = membersSnap.docs.find(
                (d) => d.data().email === email
            );

            // 6. preRegistered 서브컬렉션에서 이메일 매칭
            let preRegName = "";
            let preRegDocId = "";
            const preRegSnap = await db
                .collection("organizations")
                .doc(orgId)
                .collection("preRegistered")
                .where("email", "==", email.toLowerCase())
                .get();

            if (!preRegSnap.empty) {
                const preRegDoc = preRegSnap.docs[0];
                preRegName = preRegDoc.data().name || "";
                preRegDocId = preRegDoc.id;
            }

            // 7. admin 존재 여부 확인
            const hasAdmin = membersSnap.docs.some(
                (d) => d.data().role === "admin"
            );
            const role = hasAdmin ? "employee" : "admin";

            // 8. 사용자 문서 생성
            const finalName =
                matchedMember?.data().name || preRegName || displayName || "";

            await db
                .collection("users")
                .doc(uid)
                .set({
                    email,
                    name: finalName,
                    role,
                    organizationId: orgId,
                    phone: "",
                    createdAt: FieldValue.serverTimestamp(),
                });

            // Claims를 즉시 설정 (onDocumentWritten 트리거 대기 없이)
            // → 클라이언트의 getIdToken(true)에서 최신 Claims를 받을 수 있도록
            const { getAuth } = await import("firebase-admin/auth");
            await getAuth().setCustomUserClaims(uid, { role, orgId });

            // 9. 매칭된 preRegistered 문서 삭제
            if (preRegDocId) {
                try {
                    await db
                        .collection("organizations")
                        .doc(orgId)
                        .collection("preRegistered")
                        .doc(preRegDocId)
                        .delete();
                } catch (err) {
                    console.warn("사전 등록 문서 삭제 실패:", err);
                }
            }

            console.log(
                `[joinOrganization] 가입 완료: uid=${uid}, orgId=${orgId}, role=${role}`
            );

            return {
                success: true,
                orgId,
                orgName: orgData.name || "",
                role,
            };
        } catch (err: unknown) {
            // HttpsError는 그대로 throw
            if (err instanceof HttpsError) throw err;

            console.error("[joinOrganization] 처리 실패:", err);
            throw new HttpsError(
                "internal",
                "기관 가입 처리에 실패했습니다. 다시 시도해주세요."
            );
        }
    }
);
