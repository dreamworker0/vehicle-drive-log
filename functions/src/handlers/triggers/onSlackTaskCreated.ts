/**
 * onSlackTaskCreated — Slack 어시스턴트 워커
 *
 * slackEvents가 만든 slackTasks/{taskId} 문서를 받아 실제 처리를 수행한다:
 * 신원 매핑 → rate limit → 자연어 처리(조회/예약 제안) 또는 확인 버튼 실행 → Slack 응답.
 *
 * 이 워커는 admin SDK로 Firestore Rules를 우회하므로, 여기서의 org 검증
 * (Slack 사용자 소속 == integrations 연동 기관 == 예약 organizationId)이 유일한 방어선이다.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { SLACK_BOT_TOKEN } from "../../core/params";
import { postMessage, respondToUrl, authTest } from "../../services/slack/slackApi";
import { resolveSlackUser, getSlackIntegration } from "../../services/slack/resolveSlackUser";
import {
    handleAssistantMessage,
    executeReservationProposal,
    type ReservationProposal,
} from "../../services/assistant/handleAssistantMessage";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { getRateLimits } from "../../utils/constants";
import { log } from "../../utils/helpers";

const db = getFirestore();

/** 확인 대기 문서 유효기간 — 초과 시 버튼이 무효 처리된다 (TTL 정책으로 자동 삭제) */
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

interface SlackTask {
    kind: "message" | "action";
    teamId: string;
    slackUserId: string;
    channel: string;
    text?: string;
    responseUrl?: string;
    actionId?: string;
    confirmationId?: string;
}

/** 자연어 메시지 처리 — 조회 즉시 응답, 예약은 확인 버튼 전송 */
async function processMessage(botToken: string, task: SlackTask, actor: { uid: string; orgId: string; displayName: string }): Promise<void> {
    const result = await handleAssistantMessage(task.text || "", actor);

    if (!result.proposal) {
        await postMessage(botToken, task.channel, result.replyText);
        return;
    }

    // 예약 제안 → 확인 문서 저장 후 버튼 전송 (버튼 value에는 문서 ID만)
    const confirmRef = await db.collection("slackConfirmations").add({
        proposal: result.proposal,
        teamId: task.teamId,
        slackUserId: task.slackUserId,
        channel: task.channel,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
    });

    await postMessage(botToken, task.channel, result.replyText, [
        { type: "section", text: { type: "mrkdwn", text: result.replyText } },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "✅ 예약 확정" },
                    style: "primary",
                    action_id: "confirm_reservation",
                    value: confirmRef.id,
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "취소" },
                    action_id: "cancel_reservation",
                    value: confirmRef.id,
                },
            ],
        },
    ]);
}

/** 확인 버튼 클릭 처리 — 원 메시지를 결과 텍스트로 교체 */
async function processAction(task: SlackTask): Promise<void> {
    const respond = (text: string) =>
        task.responseUrl ? respondToUrl(task.responseUrl, { text, replace_original: true }) : Promise.resolve();

    if (!task.confirmationId) {
        await respond("처리할 수 없는 요청입니다.");
        return;
    }

    const confirmRef = db.collection("slackConfirmations").doc(task.confirmationId);
    const snap = await confirmRef.get();
    const data = snap.exists ? snap.data()! : null;

    // 소유자·팀·상태·만료 검증 — 다른 사용자의 버튼 클릭이나 만료된 제안 차단
    const expiresAt: Date | null = data?.expiresAt?.toDate ? data.expiresAt.toDate() : null;
    const invalid =
        !data ||
        data.status !== "pending" ||
        data.slackUserId !== task.slackUserId ||
        data.teamId !== task.teamId ||
        !expiresAt || expiresAt.getTime() < Date.now();

    if (invalid) {
        if (data && data.slackUserId !== task.slackUserId) {
            await respond("본인이 요청한 예약만 확정/취소할 수 있습니다.");
        } else {
            await respond("만료되었거나 이미 처리된 요청입니다. 예약이 필요하면 다시 말씀해주세요.");
        }
        return;
    }

    if (task.actionId === "cancel_reservation") {
        await confirmRef.update({ status: "cancelled", resolvedAt: FieldValue.serverTimestamp() });
        await respond("예약 요청을 취소했습니다.");
        return;
    }

    // 확정 — 상태를 먼저 선점해 중복 클릭에 의한 이중 생성 방지
    await confirmRef.update({ status: "executing", resolvedAt: FieldValue.serverTimestamp() });
    const resultText = await executeReservationProposal(data.proposal as ReservationProposal, "slack");
    await confirmRef.update({ status: "executed" });
    await respond(resultText);
}

export const onSlackTaskCreated = onDocumentCreated(
    {
        document: "slackTasks/{taskId}",
        region: "asia-northeast3",
        secrets: [SLACK_BOT_TOKEN],
        timeoutSeconds: 60,
        memory: "512MiB",
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const task = snap.data() as SlackTask;
        const botToken = SLACK_BOT_TOKEN.value();

        const fail = async (userMessage: string) => {
            if (task.kind === "action" && task.responseUrl) {
                await respondToUrl(task.responseUrl, { text: userMessage, replace_original: false });
            } else if (task.channel) {
                await postMessage(botToken, task.channel, userMessage);
            }
        };

        try {
            // 1) 워크스페이스 ↔ 기관 매핑 확인
            const integration = await getSlackIntegration(task.teamId);
            if (!integration) {
                await fail("이 Slack 워크스페이스는 차량 운행일지와 연동되어 있지 않습니다.");
                await snap.ref.update({ status: "rejected", reason: "no-integration" });
                return;
            }

            // 2) rate limit — Gemini 비용 경로이므로 fail-closed
            //    사용자 단위(teamId_slackUserId) + 기관 일일 누적 이중 방어
            const userLimit = await getRateLimits("slackAssistant");
            const orgLimit = await getRateLimits("slackAssistantDailyOrg");
            await checkRateLimitByUid("slackAssistant", `${task.teamId}_${task.slackUserId}`, userLimit.max, userLimit.windowSec, "closed");
            await checkRateLimitByUid("slackAssistantDailyOrg", integration.organizationId, orgLimit.max, orgLimit.windowSec, "closed");

            // 3) 신원 매핑 (Slack user → 앱 계정, 소속 검증 포함)
            // 진단용: 수신된 식별자 + 봇 토큰의 실제 소속 워크스페이스 기록 (개인정보 아님)
            const tokenIdentity = await authTest(botToken);
            log("INFO", "onSlackTaskCreated", "신원 매핑 시도", {
                eventTeamId: task.teamId,
                slackUserId: task.slackUserId,
                kind: task.kind,
                tokenTeamId: tokenIdentity.teamId,
                tokenTeam: tokenIdentity.team,
                tokenOk: tokenIdentity.ok,
                tokenError: tokenIdentity.error,
            });
            const resolved = await resolveSlackUser(botToken, task.teamId, task.slackUserId, integration.organizationId);
            if (!resolved.ok) {
                await fail(resolved.message);
                await snap.ref.update({ status: "rejected", reason: "identity" });
                return;
            }

            // 4) 본 처리
            if (task.kind === "action") {
                await processAction(task);
            } else {
                await processMessage(botToken, task, {
                    uid: resolved.uid,
                    orgId: resolved.orgId,
                    displayName: resolved.displayName,
                });
            }
            await snap.ref.update({ status: "done" });
        } catch (err) {
            const error = err as Error;
            if (err instanceof HttpsError && err.code === "resource-exhausted") {
                // rate limit 초과 — 사용자 안내만 하고 에러로 기록하지 않음
                await fail(error.message);
                await snap.ref.update({ status: "rate-limited" });
                return;
            }
            log("ERROR", "onSlackTaskCreated", error.message, { stack: error.stack, taskId: event.params.taskId });
            await fail("처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
            await snap.ref.update({ status: "failed", error: error.message }).catch(() => undefined);
        }
    }
);
