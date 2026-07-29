/**
 * acceptCurrentTerms — 현행 약관·처리방침 재동의 기록 (onCall)
 *
 * 동의 기록(users.consent / organizations.consent)은 Firestore Rules가 클라이언트 쓰기를
 * 전면 차단하므로, 재동의는 반드시 이 콜러블(Admin SDK)을 경유해야 한다.
 *
 * 기록 대상은 역할에 따라 다르다.
 * - 기관 관리자: 기관의 위탁 계약 동의(organizations.consent = 약관 + 처리방침)와
 *   본인의 이용약관 동의(users.consent)를 함께 기록한다. 위탁 계약의 당사자는 기관이고
 *   그 의사표시를 하는 주체가 관리자이므로 한 번의 동의로 둘 다 성립한다.
 * - 직원: 본인의 이용약관 동의(users.consent)만 기록한다. 개인정보 동의는 받지 않는다
 *   (근거는 src/types/user.ts의 consent 주석 참고).
 */
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { log, wrapHandler } from "../../utils/helpers";
import { checkRateLimitByUid } from "../../utils/rateLimit";

/** 동의한 문서 버전은 시행일(YYYY-MM-DD)만 허용 — submitOrgApplication과 동일 기준. */
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface AcceptTermsPayload {
    /** 이용약관 동의 (모든 역할 필수) */
    agreedTerms: boolean;
    termsVersion: string;
    /** 개인정보 처리방침 동의 (기관 관리자만 — 위탁 계약 성립에 필요) */
    agreedPrivacy?: boolean;
    privacyVersion?: string;
}

export const acceptCurrentTerms = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    wrapHandler("acceptCurrentTerms", async (request: CallableRequest<Partial<AcceptTermsPayload>>) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const uid = request.auth.uid;

        // 재동의는 사용자당 드물게 발생하므로 낮은 상한으로 충분하다.
        await checkRateLimitByUid("acceptCurrentTerms", uid, 10, 3600);

        const payload = request.data;

        if (payload.agreedTerms !== true) {
            throw new HttpsError("invalid-argument", "이용약관에 동의해야 계속 이용할 수 있습니다.");
        }
        if (typeof payload.termsVersion !== "string" || !VERSION_PATTERN.test(payload.termsVersion)) {
            throw new HttpsError("invalid-argument", "동의한 약관 버전 정보가 올바르지 않습니다.");
        }

        const db = getFirestore();
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
            throw new HttpsError("failed-precondition", "사용자 정보를 찾을 수 없습니다.");
        }

        const userData = userSnap.data() || {};
        const role = userData.role as string | undefined;
        const organizationId = userData.organizationId as string | null | undefined;
        const now = FieldValue.serverTimestamp();

        // 기관 관리자는 위탁 계약 당사자이므로 처리방침 동의까지 받아야 한다.
        const isOrgAdmin = role === "admin" && !!organizationId;
        if (isOrgAdmin) {
            if (payload.agreedPrivacy !== true) {
                throw new HttpsError(
                    "invalid-argument",
                    "기관 관리자는 개인정보 처리방침에도 동의해야 합니다."
                );
            }
            if (typeof payload.privacyVersion !== "string" || !VERSION_PATTERN.test(payload.privacyVersion)) {
                throw new HttpsError("invalid-argument", "동의한 처리방침 버전 정보가 올바르지 않습니다.");
            }
        }

        // 본인 이용약관 동의 — merge로 다른 필드를 건드리지 않는다.
        await userRef.set(
            {
                consent: {
                    terms: true,
                    termsVersion: payload.termsVersion,
                    agreedAt: now,
                },
            },
            { merge: true }
        );

        if (isOrgAdmin) {
            await db
                .collection("organizations")
                .doc(organizationId as string)
                .set(
                    {
                        consent: {
                            terms: true,
                            privacy: true,
                            termsVersion: payload.termsVersion,
                            privacyVersion: payload.privacyVersion,
                            agreedAt: now,
                            // 신청이 아닌 재동의로 성립한 건임을 남긴다 — 약관 제9조 ①이
                            // 신청 시점과 재동의 절차 두 경로를 모두 인정하므로 구분이 필요하다.
                            source: "reconsent",
                            agreedByUid: uid,
                        },
                    },
                    { merge: true }
                );
        }

        log("INFO", "acceptCurrentTerms", "재동의 기록", {
            uid,
            role: role || "unknown",
            orgRecorded: isOrgAdmin,
            termsVersion: payload.termsVersion,
        });

        return { success: true, orgRecorded: isOrgAdmin };
    })
);
