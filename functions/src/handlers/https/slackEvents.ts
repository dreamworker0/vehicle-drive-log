/**
 * slackEvents — Slack Events API + Interactivity 수신 엔드포인트
 *
 * Slack의 3초 ack 제한 때문에 여기서는 서명 검증과 task 문서 생성만 하고
 * 즉시 200을 반환한다. 실제 처리(Gemini 파싱·예약)는 onSlackTaskCreated
 * 워커(Firestore 트리거)가 수행한다.
 *
 * 멱등성: Events API는 3초 내 미응답 시 재시도하므로(x-slack-retry-num)
 * task 문서 ID를 event_id로 고정하고 create()의 already-exists를 무시한다.
 */
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { SLACK_SIGNING_SECRET } from "../../core/params";
import { checkSlackSignature } from "../../services/slack/verifySlackSignature";
import { wrapHttps, log } from "../../utils/helpers";
import { checkRateLimitByIp } from "../../utils/rateLimit";

const db = getFirestore();

/** task 문서 유효기간 — GCP Firestore TTL 정책(expiresAt)으로 자동 정리 */
const TASK_TTL_MS = 60 * 60 * 1000;
const MAX_TEXT_LEN = 500;

function isAlreadyExists(err: unknown): boolean {
    const e = err as { code?: number | string; message?: string };
    return e?.code === 6 || String(e?.message || "").includes("ALREADY_EXISTS");
}

async function createTaskOnce(taskId: string, data: Record<string, unknown>): Promise<void> {
    try {
        await db.collection("slackTasks").doc(taskId).create({
            ...data,
            status: "queued",
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + TASK_TTL_MS),
        });
    } catch (err) {
        if (isAlreadyExists(err)) {
            log("INFO", "slackEvents", "중복 이벤트 무시 (Slack 재시도)", { taskId });
            return;
        }
        throw err;
    }
}

async function handler(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method Not Allowed" });
        return;
    }

    // --- 서명 검증 (v0 HMAC + timestamp ±5분) ---
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const sigCheck = checkSlackSignature({
        signingSecret: SLACK_SIGNING_SECRET.value(),
        timestamp: req.headers["x-slack-request-timestamp"] as string | undefined,
        signature: req.headers["x-slack-signature"] as string | undefined,
        rawBody,
    });
    if (!sigCheck.valid) {
        const ip = req.ip || "unknown";
        const exceeded = await checkRateLimitByIp("slackEvents", ip, 30, 600);
        // 진단용: 실패 사유·본문 길이·헤더 존재 여부만 기록 (시크릿·본문 내용은 남기지 않음)
        log("WARNING", "slackEvents", "서명 검증 실패", {
            ip,
            reason: sigCheck.reason,
            bodyLength: sigCheck.bodyLength,
            hasTsHeader: Boolean(req.headers["x-slack-request-timestamp"]),
            hasSigHeader: Boolean(req.headers["x-slack-signature"]),
        });
        res.status(exceeded ? 429 : 401).json({ error: "invalid signature" });
        return;
    }

    // --- Interactivity (버튼 클릭): application/x-www-form-urlencoded, payload=<json> ---
    if (typeof req.body?.payload === "string") {
        const payload = JSON.parse(req.body.payload);
        if (payload.type === "block_actions" && Array.isArray(payload.actions) && payload.actions.length > 0) {
            const action = payload.actions[0];
            if (action.action_id === "confirm_reservation" || action.action_id === "cancel_reservation") {
                // trigger_id는 인터랙션마다 고유 — 재전송 중복 방지 겸 task ID로 사용
                await createTaskOnce(`action_${payload.trigger_id}`, {
                    kind: "action",
                    teamId: payload.team?.id || payload.user?.team_id || "",
                    slackUserId: payload.user?.id || "",
                    channel: payload.channel?.id || "",
                    responseUrl: payload.response_url || "",
                    actionId: action.action_id,
                    confirmationId: String(action.value || ""),
                });
            }
        }
        res.status(200).send("");
        return;
    }

    // --- Events API: application/json ---
    const body = req.body || {};

    // 최초 URL 등록 시 challenge 에코
    if (body.type === "url_verification") {
        res.status(200).json({ challenge: body.challenge });
        return;
    }

    if (body.type === "event_callback") {
        const event = body.event || {};
        const isDmText =
            event.type === "message" &&
            event.channel_type === "im" &&
            !event.bot_id &&          // 봇 자기 메시지 루프 방지
            !event.subtype &&         // 수정/삭제/파일 등 변형 이벤트 제외
            typeof event.user === "string" &&
            typeof event.text === "string" &&
            event.text.trim().length > 0;

        if (isDmText && body.event_id) {
            await createTaskOnce(String(body.event_id), {
                kind: "message",
                teamId: String(body.team_id || ""),
                slackUserId: event.user,
                channel: String(event.channel || ""),
                text: String(event.text).slice(0, MAX_TEXT_LEN),
            });
        }
        res.status(200).send("");
        return;
    }

    res.status(200).send("");
}

export const slackEvents = onRequest(
    {
        region: "asia-northeast3",
        secrets: [SLACK_SIGNING_SECRET],
        // 파일럿 규모에서 폭주 방지 — 수신은 가볍고 처리량이 낮다
        maxInstances: 2,
    },
    wrapHttps("slackEvents", handler)
);
