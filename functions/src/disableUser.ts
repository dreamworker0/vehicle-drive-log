/**
 * disableUser — 직원 비활성화 (Soft Delete)
 * onCall 함수: 관리자가 직원을 비활성화할 때 호출
 * Auth 비활성화 없이 users 문서의 status만 'disabled'로 변경
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const disableUser = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: false,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { uid } = request.data;
        if (!uid) {
            throw new HttpsError("invalid-argument", "비활성화할 사용자 UID가 필요합니다.");
        }

        // 자기 자신 비활성화 방지
        if (uid === request.auth.uid) {
            throw new HttpsError("failed-precondition", "자기 자신은 비활성화할 수 없습니다.");
        }

        const db = getFirestore();

        try {
            // 1. 호출자가 관리자(admin) 또는 슈퍼관리자(superAdmin)인지 확인
            const callerDoc = await db.collection("users").doc(request.auth.uid).get();
            const callerRole = callerDoc.data()?.role;
            if (callerRole !== "admin" && callerRole !== "superAdmin") {
                throw new HttpsError("permission-denied", "관리자만 직원을 비활성화할 수 있습니다.");
            }

            // 2. 대상 사용자 존재 확인 + 교차 기관 검증
            const targetDoc = await db.collection("users").doc(uid).get();
            if (!targetDoc.exists) {
                throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
            }
            if (callerRole === "admin" && callerDoc.data()?.organizationId !== targetDoc.data()?.organizationId) {
                throw new HttpsError("permission-denied", "다른 기관의 직원을 비활성화할 수 없습니다.");
            }

            // 3. users 문서의 status를 'disabled'로 변경 (soft delete)
            await db.collection("users").doc(uid).update({
                status: "disabled",
                disabledAt: FieldValue.serverTimestamp(),
            });

            console.log(`직원 비활성화 완료: ${uid} (호출자: ${request.auth.uid})`);
            return { success: true };
        } catch (err: unknown) {
            console.error("직원 비활성화 실패:", (err as Error).message);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", (err as Error).message);
        }
    }
);
