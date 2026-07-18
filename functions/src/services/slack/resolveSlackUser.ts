/**
 * resolveSlackUser — Slack 사용자를 앱 계정으로 매핑
 *
 * 흐름: integrations/slack_{teamId}로 기관 확인 → slackUsers 캐시(이메일→uid 매핑만 캐시)
 * → miss 시 users.info(이메일) → auth.getUserByEmail → users/{uid} 재검증.
 * 캐시 히트여도 users/{uid} 문서 1 read로 소속·활성 상태를 매번 재검증한다
 * (퇴사·비활성·기관 변경 대응 — 캐시는 외부 API 호출 절약이 목적).
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getSlackUserInfo } from "./slackApi";
import { log } from "../../utils/helpers";

const db = getFirestore();

export type ResolveResult =
    | { ok: true; uid: string; orgId: string; displayName: string }
    | { ok: false; message: string };

/** integrations/slack_{teamId} 문서에서 연동 기관 확인 */
export async function getSlackIntegration(teamId: string): Promise<{ organizationId: string } | null> {
    const snap = await db.collection("integrations").doc(`slack_${teamId}`).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (data.enabled !== true || !data.organizationId) return null;
    return { organizationId: data.organizationId };
}

/** uid로 users 문서를 읽어 소속·활성 상태 재검증 */
async function verifyAppUser(uid: string, expectedOrgId: string): Promise<ResolveResult> {
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
        return { ok: false, message: "앱에서 계정을 찾을 수 없습니다. 차량 운행일지 앱에 먼저 가입해주세요." };
    }
    const user = userSnap.data()!;
    if (user.status === "disabled") {
        return { ok: false, message: "비활성화된 계정입니다. 기관 관리자에게 문의해주세요." };
    }
    if (user.organizationId !== expectedOrgId) {
        return { ok: false, message: "이 Slack 워크스페이스와 연결된 기관 소속이 아닙니다. 기관 관리자에게 문의해주세요." };
    }
    return {
        ok: true,
        uid,
        orgId: expectedOrgId,
        displayName: user.name || (user.email ? String(user.email).split("@")[0] : "이름 없음"),
    };
}

export async function resolveSlackUser(
    botToken: string,
    teamId: string,
    slackUserId: string,
    expectedOrgId: string
): Promise<ResolveResult> {
    const cacheRef = db.collection("slackUsers").doc(`${teamId}_${slackUserId}`);

    // 1) 캐시 히트 — 이메일→uid 매핑만 재사용, 소속·활성은 매번 재검증
    const cached = await cacheRef.get();
    if (cached.exists && cached.data()?.uid) {
        return verifyAppUser(cached.data()!.uid, expectedOrgId);
    }

    // 2) 캐시 미스 — Slack 프로필에서 이메일 조회
    const { email } = await getSlackUserInfo(botToken, slackUserId);
    if (!email) {
        return { ok: false, message: "Slack 프로필에서 이메일을 확인할 수 없습니다. 워크스페이스 관리자에게 문의해주세요." };
    }

    // 3) 이메일 → Firebase Auth 계정 (calendarSchedule.ts 선례)
    let uid: string;
    try {
        const authUser = await getAuth().getUserByEmail(email);
        uid = authUser.uid;
    } catch {
        return {
            ok: false,
            message: `Slack 이메일(${email})로 가입된 계정을 찾을 수 없습니다. 차량 운행일지 앱의 가입 이메일과 Slack 이메일이 같아야 합니다.`,
        };
    }

    const result = await verifyAppUser(uid, expectedOrgId);
    if (result.ok) {
        // 4) 검증 통과 시에만 캐시 저장
        await cacheRef.set({
            uid,
            email,
            teamId,
            slackUserId,
            resolvedAt: FieldValue.serverTimestamp(),
        }).catch((err) => {
            log("WARNING", "resolveSlackUser", "캐시 저장 실패 (동작에는 영향 없음)", { error: (err as Error).message });
        });
    }
    return result;
}
