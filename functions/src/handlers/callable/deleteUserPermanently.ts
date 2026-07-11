/**
 * deleteUserPermanently — 비활성 직원 완전 삭제 (Hard Delete)
 * onCall 함수: 관리자가 비활성(disabled) 직원의 계정을 영구 삭제할 때 호출
 * - 삭제 범위: users 문서 + 개인 부속 데이터(즐겨찾기) + Firebase Auth 계정
 * - 운행일지·주유기록 등 기관 기록은 driverName이 비정규화되어 있어 보존된다.
 * - 비활성(disabled) 상태인 직원만 삭제 가능 — 활성 직원 즉시 삭제 방지.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const deleteUserPermanently = onCall(
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
            throw new HttpsError("invalid-argument", "삭제할 사용자 UID가 필요합니다.");
        }

        // 자기 자신 삭제 방지
        if (uid === request.auth.uid) {
            throw new HttpsError("failed-precondition", "자기 자신은 삭제할 수 없습니다.");
        }

        const db = getFirestore();

        try {
            // 1. 호출자가 관리자(admin) 또는 슈퍼관리자(superAdmin)인지 확인
            const callerDoc = await db.collection("users").doc(request.auth.uid).get();
            const callerRole = callerDoc.data()?.role;
            if (callerRole !== "admin" && callerRole !== "superAdmin") {
                throw new HttpsError("permission-denied", "관리자만 직원을 삭제할 수 있습니다.");
            }

            // 2. 대상 사용자 존재 확인 + 교차 기관 검증
            const targetDoc = await db.collection("users").doc(uid).get();
            if (!targetDoc.exists) {
                throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
            }
            const targetData = targetDoc.data();
            if (callerRole === "admin" && callerDoc.data()?.organizationId !== targetData?.organizationId) {
                throw new HttpsError("permission-denied", "다른 기관의 직원을 삭제할 수 없습니다.");
            }
            // 상위 권한(superAdmin) 계정은 삭제 불가
            if (targetData?.role === "superAdmin") {
                throw new HttpsError("permission-denied", "시스템 관리자 계정은 삭제할 수 없습니다.");
            }
            // 3. 비활성 상태인 직원만 완전 삭제 허용 (실수로 활성 직원 즉시 삭제 방지)
            if (targetData?.status !== "disabled") {
                throw new HttpsError("failed-precondition", "비활성 상태인 직원만 완전 삭제할 수 있습니다. 먼저 비활성화해 주세요.");
            }

            // 4. 개인 부속 데이터 정리 — 즐겨찾기 (운행일지 등 기관 기록은 보존)
            const favSnap = await db.collection("favorites").where("userId", "==", uid).get();
            if (!favSnap.empty) {
                // Firestore batch는 500건 제한 — 청크 단위로 삭제
                const docs = favSnap.docs;
                for (let i = 0; i < docs.length; i += 500) {
                    const batch = db.batch();
                    docs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
                    await batch.commit();
                }
            }

            // 5. users 문서 삭제
            //    (Auth 삭제보다 먼저 수행 — onUserDelete 트리거가 문서 없음(code 5)을 만나
            //     익명화를 생략하도록 순서를 보장한다)
            await db.collection("users").doc(uid).delete();

            // 6. Firebase Auth 계정 삭제
            try {
                await getAuth().deleteUser(uid);
            } catch (authErr: unknown) {
                const code = (authErr as { code?: string }).code;
                if (code === "auth/user-not-found") {
                    // Firestore 문서만 있고 Auth 계정이 없는 경우 — 문서 삭제로 충분
                    console.warn(`직원 완전 삭제: Auth 계정 없음, Firestore 문서만 삭제 (${uid})`);
                } else {
                    throw authErr;
                }
            }

            console.log(`직원 완전 삭제 완료: ${uid} (호출자: ${request.auth.uid}, 즐겨찾기 ${favSnap.size}건 정리)`);
            return { success: true };
        } catch (err: unknown) {
            console.error("직원 완전 삭제 실패:", (err as Error).message);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "직원 완전 삭제 중 오류가 발생했습니다.");
        }
    }
);
