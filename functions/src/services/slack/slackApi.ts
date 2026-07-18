/**
 * slackApi — Slack Web API 최소 클라이언트 (fetch 기반, SDK 미도입)
 *
 * 파일럿에 필요한 3개 호출만 감싼다: chat.postMessage, users.info, response_url POST.
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
async function slackApiCallForm(method: string, botToken: string, params: Record<string, string>): Promise<SlackApiResponse> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Authorization": `Bearer ${botToken}`,
        },
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json() as SlackApiResponse;
    if (!data.ok) {
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
