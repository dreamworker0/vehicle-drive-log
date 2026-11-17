/**
 * enableUser — 비활성 직원 다시 활성화 (disableUser의 짝)
 * onCall 함수: 관리자가 직원 관리 화면에서 [다시 활성화]를 누를 때 호출
 *
 * ## 왜 서버에서 하나
 * disableUser는 문서 status와 함께 **Auth 계정도 막는다**(2026-07-10 감사 #1). 그런데 재활성화는
 * 클라이언트가 users 문서만 고쳤다 — 관리자 목록에는 '활성'인데 Auth가 막혀 있어 직원이 Google
 * 로그인하면 auth/user-disabled로 로그인 화면에 되돌아왔다(2026-11-18 기관 문의).
 * Auth 계정은 Admin SDK로만 풀 수 있으므로 재활성화도 서버로 옮긴다.
 *
 * ## 순서 — Auth를 먼저 푼다
 * Auth를 풀고 문서 쓰기가 실패하면 목록에 '비활성'이 남아 관리자가 다시 누르게 된다(드러나는 실패).
 * 반대로 문서를 먼저 고치고 Auth가 실패하면 이번 사고와 같은 '보이지 않는 반쪽 복구'가 된다.
 * 두 단계 모두 몇 번을 다시 해도 같은 결과라 재시도에 안전하다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const enableUser = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { uid } = request.data ?? {};
        if (!uid || typeof uid !== "string") {
            throw new HttpsError("invalid-argument", "활성화할 사용자 UID가 필요합니다.");
        }

        const db = getFirestore();

        try {
            // 1. 호출자가 관리자(admin) 또는 슈퍼관리자(superAdmin)인지 확인
            const callerDoc = await db.collection("users").doc(request.auth.uid).get();
            const callerRole = callerDoc.data()?.role;
            if (callerRole !== "admin" && callerRole !== "superAdmin") {
                throw new HttpsError("permission-denied", "관리자만 직원을 활성화할 수 있습니다.");
            }

            // 2. 대상 사용자 존재 확인 + 교차 기관 검증 (disableUser와 같은 기준)
            const targetDoc = await db.collection("users").doc(uid).get();
            if (!targetDoc.exists) {
                throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
            }
            const callerOrgId = callerDoc.data()?.organizationId;
            if (callerRole === "admin" && (!callerOrgId || callerOrgId !== targetDoc.data()?.organizationId)) {
                throw new HttpsError("permission-denied", "다른 기관의 직원을 활성화할 수 없습니다.");
            }
            if (callerRole === "admin" && targetDoc.data()?.role === "superAdmin") {
                throw new HttpsError("permission-denied", "시스템 관리자 계정은 변경할 수 없습니다.");
            }

            // 3. Auth 계정 차단 해제 — Auth 계정이 없으면(문서만 남은 계정) 문서 복구로 충분하다
            try {
                await getAuth().updateUser(uid, { disabled: false });
            } catch (authErr: unknown) {
                const code = (authErr as { code?: string }).code;
                if (code === "auth/user-not-found") {
                    console.warn(`직원 활성화: Auth 계정 없음, Firestore status만 적용 (${uid})`);
                } else {
                    throw authErr;
                }
            }

            // 4. users 문서 복구. 행위자 스탬프는 접속기록(auditUserUpdated)의 '계정' 항목이다 —
            //    서버 쓰기라 클라이언트 actorStamp가 없으므로 호출자를 직접 적는다.
            await db.collection("users").doc(uid).update({
                status: "active",
                disabledAt: null,
                lastEditedByUid: request.auth.uid,
            });

            console.log(`직원 활성화 완료: ${uid} (호출자: ${request.auth.uid})`);
            return { success: true };
        } catch (err: unknown) {
            console.error("직원 활성화 실패:", (err as Error).message);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "직원 활성화 중 오류가 발생했습니다.");
        }
    }
);
