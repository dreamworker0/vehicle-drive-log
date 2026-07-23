/**
 * slackApi — Slack Web API 최소 클라이언트 (fetch 기반, SDK 미도입)
 *
 * 메시지(chat.postMessage, reactions.add), 읽기(users.info, auth.test),
 * response_url POST, OAuth(oauth.v2.access, auth.revoke)를 감싼다.
 */
import { log } from "../../utils/helpers";

const SLACK_API_BASE = "https://slack.com/api";

interface SlackApiResponse {
    ok: boolean;
    error?: string;
    [key: string]: unknown;
}

/** JSON 본문 호출 — 쓰기 계열(chat.postMessage 등)에 사용 */
async function slackApiCall(method: string, botToken: string, payload: Record<string, unknown>): Promise<SlackApiResponse> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Bearer ${botToken}`,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json() as SlackApiResponse;
    if (!data.ok) {
        log("WARNING", "slackApi", `Slack API ${method} 실패`, { error: data.error });
    }
    return data;
}

/**
 * form-urlencoded 호출 — 읽기 계열(users.info 등)에 사용.
 * Slack 읽기 메서드는 JSON 본문의 인자를 파싱하지 못해 파라미터가 누락되므로
 * (예: users.info가 user 없이 호출되어 user_not_found) 반드시 폼 인코딩으로 보낸다.
 */
async function slackApiCallForm(
    method: string,
    botToken: string,
    params: Record<string, string>,
    /** 기대되는(=노이즈) 에러 코드는 WARNING 로그를 남기지 않는다. 예: 미매칭 조회의 users_not_found */
    silentErrors?: string[]
): Promise<SlackApiResponse> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Authorization": `Bearer ${botToken}`,
        },
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json() as SlackApiResponse;
    if (!data.ok && !(data.error && silentErrors?.includes(data.error))) {
        log("WARNING", "slackApi", `Slack API ${method} 실패`, { error: data.error });
    }
    return data;
}

/** DM/채널에 메시지 전송. blocks가 있으면 text는 알림용 폴백 텍스트로 쓰인다 */
export async function postMessage(
    botToken: string,
    channel: string,
    text: string,
    blocks?: unknown[]
): Promise<boolean> {
    const data = await slackApiCall("chat.postMessage", botToken, {
        channel,
        text,
        ...(blocks ? { blocks } : {}),
    });
    return data.ok;
}

/** 메시지에 이모지 리액션 추가 — "접수/처리 중" 즉시 피드백용. 실패는 무시(비필수) */
export async function addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<boolean> {
    const data = await slackApiCall("reactions.add", botToken, { channel, timestamp, name });
    return data.ok;
}

/** 봇 토큰의 실제 소속 워크스페이스·봇 신원 확인 (진단용) */
export async function authTest(botToken: string): Promise<{ ok: boolean; teamId: string | null; team: string | null; botUserId: string | null; error?: string }> {
    const data = await slackApiCall("auth.test", botToken, {});
    return {
        ok: data.ok,
        teamId: (data.team_id as string) || null,
        team: (data.team as string) || null,
        botUserId: (data.user_id as string) || null,
        error: data.error,
    };
}

/** Slack 사용자 프로필 조회 — 이메일 매핑용 (users:read.email 스코프 필요) */
export async function getSlackUserInfo(
    botToken: string,
    slackUserId: string
): Promise<{ email: string | null; realName: string | null }> {
    const data = await slackApiCallForm("users.info", botToken, { user: slackUserId });
    if (!data.ok) return { email: null, realName: null };
    const user = data.user as { profile?: { email?: string; real_name?: string } } | undefined;
    return {
        email: user?.profile?.email || null,
        realName: user?.profile?.real_name || null,
    };
}

/**
 * 이메일로 Slack 사용자 ID 조회 (users.lookupByEmail, 읽기 계열 → form-urlencoded).
 * outbound DM 발송 시 앱 계정 이메일 → Slack userId 매핑에 사용한다(users:read.email 스코프 필요).
 * 미가입·미매칭(users_not_found 등)이나 오류 시 null을 반환해 호출부가 조용히 skip하게 한다.
 */
export async function lookupUserByEmail(botToken: string, email: string): Promise<string | null> {
    // users_not_found(Slack 미가입/이메일 불일치)·missing_scope는 정상적 skip 사유이므로 로그 노이즈로 남기지 않는다.
    const data = await slackApiCallForm("users.lookupByEmail", botToken, { email }, ["users_not_found", "missing_scope"]);
    if (!data.ok) return null;
    const user = data.user as { id?: string } | undefined;
    return user?.id || null;
}

/**
 * OAuth v2 code → 봇 토큰 교환 (oauth.v2.access).
 * 앱 크리덴셜(client_id/secret)로 호출하며 봇 토큰이 없다(설치 시점).
 * 응답의 access_token이 워크스페이스별 봇 토큰(xoxb-)이다.
 */
export async function oauthV2Access(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
): Promise<{ ok: boolean; accessToken: string | null; teamId: string | null; teamName: string | null; botUserId: string | null; scope: string | null; error?: string }> {
    const res = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        }).toString(),
    });
    const data = await res.json() as SlackApiResponse;
    if (!data.ok) {
        log("WARNING", "slackApi", "oauth.v2.access 실패", { error: data.error });
    }
    const team = data.team as { id?: string; name?: string } | undefined;
    return {
        ok: data.ok,
        accessToken: (data.access_token as string) || null,
        teamId: team?.id || null,
        teamName: team?.name || null,
        botUserId: (data.bot_user_id as string) || null,
        scope: (data.scope as string) || null,
        error: data.error,
    };
}

/** 봇 토큰 무효화 (auth.revoke) — 연결 해제 시 Slack 측에서도 폐기. 실패는 무시 가능 */
export async function authRevoke(token: string): Promise<boolean> {
    const data = await slackApiCall("auth.revoke", token, {});
    return data.ok === true && data.revoked === true;
}

/**
 * 워크스페이스 사용자 이메일 수집 (users.list, 읽기 계열 → form-urlencoded).
 * 연결 진단(직원 이메일 매칭)용 — 봇·삭제 계정은 제외하고 소문자 이메일 Set을 반환.
 * 페이지네이션 cursor를 따라가되 과도한 호출 방지를 위해 최대 5페이지(약 1,000명)로 제한.
 */
export async function listSlackEmails(botToken: string): Promise<{ ok: boolean; emails: Set<string>; error?: string }> {
    const emails = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 5; page++) {
        const params: Record<string, string> = { limit: "200" };
        if (cursor) params.cursor = cursor;
        const data = await slackApiCallForm("users.list", botToken, params);
        if (!data.ok) return { ok: false, emails, error: data.error };

        const members = (data.members as Array<{ deleted?: boolean; is_bot?: boolean; profile?: { email?: string } }>) || [];
        for (const m of members) {
            if (m.deleted || m.is_bot) continue;
            const email = m.profile?.email;
            if (email) emails.add(email.toLowerCase());
        }
        cursor = ((data.response_metadata as { next_cursor?: string })?.next_cursor || "").trim();
        if (!cursor) break;
    }
    return { ok: true, emails };
}

/** Interactivity response_url로 응답 (원 메시지 교체 등) */
export async function respondToUrl(
    responseUrl: string,
    payload: { text: string; replace_original?: boolean; blocks?: unknown[] }
): Promise<void> {
    const res = await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        log("WARNING", "slackApi", "response_url 응답 실패", { status: res.status });
    }
}
