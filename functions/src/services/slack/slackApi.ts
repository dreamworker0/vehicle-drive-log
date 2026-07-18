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

/** Slack 사용자 프로필 조회 — 이메일 매핑용 (users:read.email 스코프 필요) */
export async function getSlackUserInfo(
    botToken: string,
    slackUserId: string
): Promise<{ email: string | null; realName: string | null }> {
    const data = await slackApiCall("users.info", botToken, { user: slackUserId });
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
