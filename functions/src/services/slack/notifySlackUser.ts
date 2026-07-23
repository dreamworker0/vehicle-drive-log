/**
 * notifySlackUser — 앱 사용자에게 outbound Slack DM 발송
 *
 * 예약 임박 등 알림을 예약자 본인의 Slack DM으로 보낸다. 격리는 기관(organizationId)
 * 단위로만 봇 토큰을 찾고(findSlackIntegrationByOrg → getSlackIntegration) 그 기관 토큰으로만
 * 발송한다. 매핑 키는 앱 계정 이메일 → Slack userId(users.lookupByEmail).
 *
 * 모든 실패(미연동/이메일 불일치/Slack 미가입/API 오류)는 조용히 skip한다 — Slack은 부가
 * 채널이므로 기존 FCM·인앱 알림 파이프라인을 절대 막지 않는다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { findSlackIntegrationByOrg, getSlackIntegration } from "./resolveSlackUser";
import { lookupUserByEmail, postMessage } from "./slackApi";
import { log } from "../../utils/helpers";

const db = getFirestore();

/**
 * 기관 ID로 활성 Slack 연동의 복호화된 봇 토큰을 얻는다. 미연동/비활성/복호화 실패 시 null.
 * 리마인더처럼 같은 run에서 여러 사용자에게 보낼 때 호출부가 org별로 결과를 캐시하면
 * integrations 조회를 1회로 줄일 수 있다.
 */
export async function resolveOrgSlackBotToken(orgId: string): Promise<string | null> {
    try {
        const found = await findSlackIntegrationByOrg(orgId);
        if (!found) return null;
        const integration = await getSlackIntegration(found.teamId);
        return integration?.botToken ?? null;
    } catch (err) {
        log("WARNING", "notifySlackUser", "봇 토큰 조회 실패", { orgId, error: (err as Error).message });
        return null;
    }
}

/**
 * 봇 토큰으로 특정 앱 사용자(uid)에게 Slack DM을 보낸다.
 * uid → 이메일(users 문서) → Slack userId(lookupByEmail) → DM 발송(user ID를 channel로 전달).
 * 발송 성공 시 true, 그 외(이메일 없음/미매칭/API 실패/예외)는 조용히 false.
 */
export async function sendSlackDMToUser(botToken: string, uid: string, text: string): Promise<boolean> {
    try {
        const userSnap = await db.collection("users").doc(uid).get();
        const email = userSnap.exists ? (userSnap.data()?.email as string | undefined) : undefined;
        if (!email) return false;

        const slackUserId = await lookupUserByEmail(botToken, email);
        if (!slackUserId) return false;

        return await postMessage(botToken, slackUserId, text);
    } catch (err) {
        log("WARNING", "notifySlackUser", "Slack DM 발송 실패", { uid, error: (err as Error).message });
        return false;
    }
}
