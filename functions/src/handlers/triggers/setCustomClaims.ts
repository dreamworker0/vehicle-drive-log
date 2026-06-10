/**
 * setCustomClaims — 사용자 문서 변경 시 Custom Claims 자동 설정
 *
 * users/{uid} 문서가 생성/수정/삭제될 때 Firebase Auth Custom Claims를 동기화.
 * Claims에 role과 orgId를 저장하여 Firestore 보안 규칙에서 get() 호출 없이
 * 역할/기관 검증이 가능하도록 함.
 */
import { onDocumentWritten } from "firebase-functions/firestore";
import { getAuth } from "firebase-admin/auth";

export const setCustomClaims = onDocumentWritten(
    {
        document: "users/{uid}",
        region: "asia-northeast3",
    },
    async (event) => {
        const uid = event.params.uid;
        const after = event.data?.after?.data();

        try {
            if (!after) {
                // 문서 삭제 → Claims 초기화
                await getAuth().setCustomUserClaims(uid, {});
                console.log(`[CustomClaims] Claims 초기화: ${uid}`);
                return;
            }

            // 시스템에 정의된 역할만 Claims에 반영 — 예상 밖 값이 문서에 들어와도 권한 상승으로 이어지지 않도록 employee로 강등
            const VALID_ROLES = ["superAdmin", "admin", "employee"];
            const newClaims = {
                role: VALID_ROLES.includes(after.role) ? after.role : "employee",
                orgId: after.organizationId || null,
            };

            // 변경 전 Claims와 비교하여 불필요한 업데이트 방지
            const before = event.data?.before?.data();
            if (before) {
                const prevRole = before.role || "employee";
                const prevOrgId = before.organizationId || null;
                if (prevRole === newClaims.role && prevOrgId === newClaims.orgId) {
                    // role, orgId 변경 없으면 스킵
                    return;
                }
            }

            await getAuth().setCustomUserClaims(uid, newClaims);
            console.log(
                `[CustomClaims] Claims 설정 완료: ${uid} → role=${newClaims.role}, orgId=${newClaims.orgId}`
            );
        } catch (err: unknown) {
            // Auth에 존재하지 않는 UID인 경우 (문서만 있고 Auth 계정이 없는 경우)
            const authErr = err as { code?: string };
            if (authErr.code === "auth/user-not-found") {
                console.warn(
                    `[CustomClaims] Auth 계정 없음, Claims 설정 스킵: ${uid}`
                );
                return;
            }
            console.error(`[CustomClaims] Claims 설정 실패: ${uid}`, err);
        }
    }
);
