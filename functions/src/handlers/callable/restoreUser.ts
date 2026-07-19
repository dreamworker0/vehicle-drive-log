/**
 * restoreUser — 비활성화된 계정을 복원 (Auth re-enable + Firestore 문서 재생성)
 * onCall 함수: 슈퍼관리자가 기관 관리에서 호출
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { maskEmail } from "../../utils/mask";

export const restoreUser = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { email, organizationId, name, role } = request.data;
        // 클라이언트 입력 role은 화이트리스트로 제한 (superAdmin 주입 방지)
        const safeRole = ["employee", "admin"].includes(role) ? role : "employee";
        if (!email) {
            throw new HttpsError("invalid-argument", "복원할 사용자 이메일이 필요합니다.");
        }
        if (!organizationId) {
            throw new HttpsError("invalid-argument", "기관 ID가 필요합니다.");
        }

        const db = getFirestore();
        const auth = getAuth();

        try {
            // 1. 호출자가 슈퍼관리자인지 확인
            const callerDoc = await db.collection("users").doc(request.auth.uid).get();
            const callerRole = callerDoc.data()?.role;
            if (callerRole !== "superAdmin") {
                throw new HttpsError("permission-denied", "슈퍼관리자만 계정을 복원할 수 있습니다.");
            }

            // 2. 대상 기관 존재 및 승인 상태 검증
            const orgDoc = await db.collection("organizations").doc(organizationId).get();
            if (!orgDoc.exists || orgDoc.data()?.status !== "approved") {
                throw new HttpsError("not-found", "유효하지 않은 기관입니다. 승인된 기관만 복원 대상이 됩니다.");
            }

            // 3. Firebase Auth에서 이메일로 사용자 검색
            let authUser;
            try {
                authUser = await auth.getUserByEmail(email);
            } catch (err: unknown) {
                const authErr = err as { code?: string };
                if (authErr.code === "auth/user-not-found") {
                    throw new HttpsError("not-found", "해당 이메일로 등록된 Firebase Auth 계정이 없습니다.");
                }
                throw err;
            }

            // 3. 이미 활성화된 계정인지 확인
            if (!authUser.disabled) {
                // Firestore 문서만 없는 경우 — 문서만 재생성
                const existingDoc = await db.collection("users").doc(authUser.uid).get();
                if (existingDoc.exists) {
                    throw new HttpsError("already-exists", "이 계정은 이미 활성 상태입니다.");
                }
            }

            // 4. Auth 계정 re-enable
            if (authUser.disabled) {
                await auth.updateUser(authUser.uid, { disabled: false });
            }

            // 5. Firestore users 문서 재생성
            await db.collection("users").doc(authUser.uid).set({
                name: name || authUser.displayName || email.split("@")[0],
                email: email,
                organizationId: organizationId,
                role: safeRole,
                restoredAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
            });

            console.log(`계정 복원 완료: ${maskEmail(email)} (uid: ${authUser.uid}, 호출자: ${request.auth.uid})`);
            return {
                success: true,
                uid: authUser.uid,
                name: name || authUser.displayName || email.split("@")[0],
                email: email,
            };
        } catch (err: unknown) {
            console.error("계정 복원 실패:", (err as Error).message);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "계정 복원 중 오류가 발생했습니다.");
        }
    }
);
