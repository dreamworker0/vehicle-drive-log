/**
 * regenerateInviteCode — 기관 초대 코드 재발급 (기관관리자·superAdmin)
 *
 * ## 왜 서버에서 하는가 (2026-09-02 보안 점검)
 *
 * 종전에는 클라이언트가 난수를 만들어 `organizations/{id}.inviteCode`를 직접 썼다. 그러려면
 * Rules가 기관관리자에게 `inviteCode` 쓰기를 열어 둬야 하는데, 열어 두면 **값을 고를 수 있다** —
 * 다른 기관의 초대 코드를 자기 기관에 복사하면 `joinOrganization`의
 * `where inviteCode == code limit(1)`이 두 기관 중 하나를 찍어 신규 직원을 가로챌 수 있었다.
 * 초대 코드는 기관 데이터 전체를 여는 단일 자격증명이므로(`utils/inviteCode.ts` 주석),
 * **누가 만들었든 값을 선택할 수 없어야** 한다. 그래서 Rules는 기관관리자의 `inviteCode` 쓰기를
 * 닫고, 재발급은 이 콜러블만 한다 — 서버 난수 + 전체 기관 대상 중복 검사.
 *
 * 권한은 커스텀 클레임(`role`·`orgId`)으로 본다. Rules와 같은 근거를 쓰기 위해서다
 * (`setCustomClaims` 트리거가 users 문서에서 동기화한다).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { wrapCallableHandler } from "../../utils/helpers";
import { generateInviteCode } from "../../utils/inviteCode";

const db = getFirestore();

/** 32^6 공간에서 충돌은 사실상 없지만, 있으면 새 값을 뽑는다. 5회면 충분하다. */
const MAX_ATTEMPTS = 5;

interface RegenerateInviteCodeRequest {
    organizationId?: unknown;
}

export const regenerateInviteCode = onCall(
    // 관리자 설정 화면(InAppBrowserGuard 안쪽)에서만 호출되므로 App Check 토큰을 항상 기대할 수 있다.
    { region: "asia-northeast3", enforceAppCheck: true },
    wrapCallableHandler<RegenerateInviteCodeRequest, { inviteCode: string }>(
        "regenerateInviteCode",
        // 정상 사용은 한 기관에서 몇 달에 한 번이다. 상한은 남용(코드 회전으로 가입 방해)만 막으면 된다.
        { rateLimitKey: "regenerateInviteCode" },
        async (request) => {
            const { organizationId } = request.data ?? {};
            if (typeof organizationId !== "string" || organizationId.length === 0) {
                throw new HttpsError("invalid-argument", "organizationId가 필요합니다.");
            }

            // wrapCallableHandler가 인증을 먼저 확인하므로 auth는 존재한다.
            const token = request.auth!.token as { role?: unknown; orgId?: unknown };
            const isSuperAdmin = token.role === "superAdmin";
            const isOrgAdmin = token.role === "admin" && token.orgId === organizationId;
            if (!isSuperAdmin && !isOrgAdmin) {
                throw new HttpsError("permission-denied", "해당 기관의 관리자만 초대 코드를 재발급할 수 있습니다.");
            }

            const orgRef = db.collection("organizations").doc(organizationId);
            const orgSnap = await orgRef.get();
            if (!orgSnap.exists) {
                throw new HttpsError("not-found", "기관을 찾을 수 없습니다.");
            }
            if (orgSnap.data()?.status !== "approved") {
                throw new HttpsError("failed-precondition", "승인된 기관만 초대 코드를 재발급할 수 있습니다.");
            }

            let inviteCode: string | null = null;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const candidate = generateInviteCode();
                // 상태를 가리지 않고 본다 — 반려·삭제된 기관의 옛 코드와도 겹치지 않게 해서
                // 복구 시 두 기관이 같은 코드를 갖는 상황을 미리 막는다.
                const dup = await db.collection("organizations")
                    .where("inviteCode", "==", candidate)
                    .limit(1)
                    .get();
                if (dup.empty) {
                    inviteCode = candidate;
                    break;
                }
            }
            if (!inviteCode) {
                throw new HttpsError("internal", "초대 코드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
            }

            await orgRef.update({ inviteCode });
            return { inviteCode };
        },
    ),
);
