/**
 * slackOauthCallback — Slack 셀프서비스 설치 OAuth 콜백 (브라우저 리다이렉트 수신)
 *
 * 흐름: state 검증(oauthState) → nonce 1회 소비(트랜잭션, 재생 차단) →
 * oauth.v2.access로 code→봇 토큰 교환 → 토큰 암호화 후 integrations/slack_{teamId} 기록 →
 * 앱으로 302 리다이렉트(?slack=connected|error). 토큰은 절대 렌더/로깅하지 않는다.
 *
 * organizationId는 서명된 state에서만 오므로(인증된 관리자가 발급) 콜백에서 조작 불가.
 * 이미 다른 기관에 연결된 워크스페이스는 거부한다(중복 바인딩 방지).
 */
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, SLACK_TOKEN_ENC_KEY } from "../../core/params";
import { oauthV2Access } from "../../services/slack/slackApi";
import { verifyState } from "../../services/slack/oauthState";
import { encryptSlackToken } from "../../services/slack/tokenCrypto";
import { wrapHttps, log } from "../../utils/helpers";
import { checkRateLimitByIp } from "../../utils/rateLimit";

const db = getFirestore();

const APP_URL = "https://vehicle-drive-log.web.app";
const REDIRECT_URI = "https://asia-northeast3-vehicle-drive-log.cloudfunctions.net/slackOauthCallback";

function redirect(res: Response, params: string): void {
    // 설정 페이지로 복귀 — SlackIntegrationSection이 ?slack= 쿼리를 감지해 토스트를 띄운다
    res.redirect(302, `${APP_URL}/admin/settings?${params}`);
}

async function handler(req: Request, res: Response): Promise<void> {
    if (req.method !== "GET") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    // 코드 추측 완화용 IP rate limit (fail-open — 정상 설치를 막지 않음)
    const ip = req.ip || "unknown";
    const exceeded = await checkRateLimitByIp("slackOauthCallback", ip, 30, 600).catch(() => false);
    if (exceeded) {
        res.status(429).send("Too Many Requests");
        return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const stateParam = typeof req.query.state === "string" ? req.query.state : undefined;

    // 사용자가 Slack 동의 화면에서 취소한 경우
    if (typeof req.query.error === "string") {
        log("INFO", "slackOauthCallback", "사용자가 설치를 취소함", { error: req.query.error });
        redirect(res, "slack=error&reason=cancelled");
        return;
    }

    // 1) state 검증 (HMAC + TTL)
    const payload = verifyState(stateParam, SLACK_STATE_SECRET.value());
    if (!payload || !code) {
        log("WARNING", "slackOauthCallback", "state 검증 실패 또는 code 누락", { hasCode: Boolean(code), hasState: Boolean(stateParam) });
        redirect(res, "slack=error&reason=invalid_state");
        return;
    }

    // 2) nonce 1회 소비 (트랜잭션) — 재생/만료 차단
    let consumedOrgId: string | null = null;
    try {
        consumedOrgId = await db.runTransaction(async (tx) => {
            const ref = db.collection("slackOauthStates").doc(payload.nonce);
            const snap = await tx.get(ref);
            if (!snap.exists) return null;
            tx.delete(ref);
            return (snap.data()?.organizationId as string) || null;
        });
    } catch (err) {
        log("ERROR", "slackOauthCallback", "nonce 소비 트랜잭션 실패", { error: (err as Error).message });
        redirect(res, "slack=error&reason=server");
        return;
    }
    if (!consumedOrgId || consumedOrgId !== payload.organizationId) {
        // 이미 사용된 state이거나(재생) org 불일치
        redirect(res, "slack=error&reason=used_or_expired");
        return;
    }

    // 3) code → 봇 토큰 교환
    const oauth = await oauthV2Access(SLACK_CLIENT_ID.value(), SLACK_CLIENT_SECRET.value(), code, REDIRECT_URI);
    if (!oauth.ok || !oauth.accessToken || !oauth.teamId) {
        log("WARNING", "slackOauthCallback", "oauth.v2.access 실패", { error: oauth.error });
        redirect(res, "slack=error&reason=exchange_failed");
        return;
    }

    const teamId = oauth.teamId;
    const intgRef = db.collection("integrations").doc(`slack_${teamId}`);

    // 4) 중복 바인딩 차단 — 이 워크스페이스가 이미 다른 기관에 연결돼 있으면 거부
    const existing = await intgRef.get();
    if (existing.exists) {
        const existingOrg = existing.data()?.organizationId as string | undefined;
        if (existingOrg && existingOrg !== payload.organizationId) {
            log("WARNING", "slackOauthCallback", "워크스페이스가 다른 기관에 이미 연결됨", { teamId });
            redirect(res, "slack=error&reason=already_linked");
            return;
        }
    }

    // 5) 토큰 암호화 후 저장 (평문 토큰은 로깅/렌더 금지)
    try {
        const tokenCipher = encryptSlackToken(teamId, oauth.accessToken);
        await intgRef.set({
            platform: "slack",
            teamId,
            teamName: oauth.teamName || null,
            botUserId: oauth.botUserId || null,
            organizationId: payload.organizationId,
            scope: oauth.scope || null,
            enabled: true,
            revoked: false,
            tokenCipher,
            connectedBy: payload.uid,
            connectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        log("ERROR", "slackOauthCallback", "토큰 저장 실패", { teamId, error: (err as Error).message });
        redirect(res, "slack=error&reason=server");
        return;
    }

    log("INFO", "slackOauthCallback", "Slack 워크스페이스 연결 완료", { teamId, organizationId: payload.organizationId });
    redirect(res, "slack=connected");
}

export const slackOauthCallback = onRequest(
    {
        region: "asia-northeast3",
        secrets: [SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, SLACK_TOKEN_ENC_KEY],
        maxInstances: 3,
    },
    wrapHttps("slackOauthCallback", handler)
);
