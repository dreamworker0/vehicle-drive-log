/**
 * getSlackInstallUrl — Slack 셀프서비스 설치 URL 발급 (기관 관리자용)
 *
 * 앱에 로그인한 관리자가 "Slack 연결"을 누르면 호출된다. organizationId는
 * request.data가 아니라 인증 토큰(orgId 클레임)에서 가져와 브라우저 조작을 막는다.
 * 서명된 state(oauthState)에 org·uid·nonce를 담고, 1회성 nonce를 slackOauthStates에
 * 기록한 뒤 Slack authorize URL을 반환한다. 실제 토큰 저장은 slackOauthCallback이 한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { SLACK_CLIENT_ID, SLACK_STATE_SECRET } from "../../core/params";
import { signState, newNonce, STATE_TTL_SEC, type OAuthStatePayload } from "../../services/slack/oauthState";

const db = getFirestore();

/** 콜백 엔드포인트(Slack 앱 OAuth Redirect URL과 반드시 일치) */
const REDIRECT_URI = "https://asia-northeast3-vehicle-drive-log.cloudfunctions.net/slackOauthCallback";
/** 봇 스코프 — 단일 배포형 앱의 Bot Token Scopes와 일치해야 한다.
 *  파일럿에서 검증된 최소 세트: 수신 DM 응답은 chat:write로 충분(im:write 불필요). */
const BOT_SCOPES = "chat:write,reactions:write,users:read,users:read.email,im:history";

export const getSlackInstallUrl = onCall(
    {
        region: "asia-northeast3",
        secrets: [SLACK_CLIENT_ID, SLACK_STATE_SECRET],
        timeoutSeconds: 15,
        memory: "256MiB",
        cors: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const role = request.auth.token.role as string | undefined;
        if (role !== "admin" && role !== "superAdmin") {
            throw new HttpsError("permission-denied", "기관 관리자만 Slack을 연결할 수 있습니다.");
        }
        const organizationId = request.auth.token.orgId as string | undefined;
        if (!organizationId) {
            throw new HttpsError("failed-precondition", "소속 기관 정보를 확인할 수 없습니다.");
        }

        const nonce = newNonce();
        const iat = Math.floor(Date.now() / 1000);
        const payload: OAuthStatePayload = { organizationId, uid: request.auth.uid, nonce, iat };

        // 1회성 nonce 기록 (콜백에서 트랜잭션으로 소비 → 재생 차단). TTL 정책으로 자동 정리
        await db.collection("slackOauthStates").doc(nonce).set({
            organizationId,
            uid: request.auth.uid,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + STATE_TTL_SEC * 1000),
        });

        const state = signState(payload, SLACK_STATE_SECRET.value());
        const url =
            "https://slack.com/oauth/v2/authorize?" +
            new URLSearchParams({
                client_id: SLACK_CLIENT_ID.value(),
                scope: BOT_SCOPES,
                redirect_uri: REDIRECT_URI,
                state,
            }).toString();

        return { url };
    }
);
