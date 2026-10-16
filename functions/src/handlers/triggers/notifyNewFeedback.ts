/**
 * notifyNewFeedback — 의견 등록 시 운영 채널(Discord) 알림
 *
 * Firestore `feedbacks` 컬렉션 onCreate 트리거.
 *
 * 종전 `generateFeedbackDraft`는 알림과 함께 Gemini로 답변 초안을 만들어 의견 관리 화면에
 * 채워 넣었다. 2026-10-16 운영자 요청으로 AI 초안을 없앴다 — 답변은 시스템 관리자가 직접 쓴다.
 * 알림은 남기므로 함수 이름을 하는 일에 맞게 바꿨다.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { sendDiscordAlert } from "../../core/discord";
import { log } from "../../utils/helpers";
import { checkRateLimitBySubject } from "../../utils/rateLimit";
import { GLOBAL_BUDGETS } from "../../utils/constants";
const db = getFirestore();

/**
 * 알림 쿼터를 소비한다 (통과 시 true).
 *
 * **왜 트리거 안에 두는가**: 이 함수의 방아쇠는 Firestore 쓰기라 콜러블용 rate limit이
 * 닿지 않는다. Rules는 "몇 번 쓸 수 있는가"를 표현하지 못한다(2026-08-14 감사 발견 1).
 * 남용 상황에서 운영 채널이 도배되면 진짜 의견이 묻힌다 — 의견 문서 자체는 그대로 남아
 * 의견 관리 화면에서 볼 수 있다.
 *
 * 작성자별·전역 두 겹인 이유: 작성자별만 두면 계정을 늘려 우회하고, 전역만 두면 한 사람이
 * 예산을 태워 다른 사람의 알림을 막는다. 둘 다 fail-closed다.
 */
async function consumeAlertQuota(authorUid: string): Promise<boolean> {
    const perAuthor = GLOBAL_BUDGETS.feedbackAlertPerAuthor;
    const global = GLOBAL_BUDGETS.feedbackAlert;

    const authorExceeded = await checkRateLimitBySubject(
        "feedbackAlert", `uid_${authorUid || "unknown"}`, perAuthor.max, perAuthor.windowSec, "closed",
    );
    if (authorExceeded) {
        log("WARNING", "notifyNewFeedback", "작성자 일일 알림 한도 초과 — 알림 생략", { authorUid });
        return false;
    }

    const globalExceeded = await checkRateLimitBySubject(
        "feedbackAlertGlobal", "__global__", global.max, global.windowSec, "closed",
    );
    if (globalExceeded) {
        log("WARNING", "notifyNewFeedback", "전역 일일 알림 예산 소진 — 알림 생략", { authorUid });
        return false;
    }
    return true;
}

export const notifyNewFeedback = onDocumentCreated(
    {
        document: "feedbacks/{feedbackId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const data = snap.data();
        const message: string = data.message || data.content || "";

        if (!message.trim()) {
            console.log("[notifyNewFeedback] 빈 의견 — 알림 생략");
            return;
        }

        if (!await consumeAlertQuota((data.authorUid as string) || "")) return;

        const userNameInfo = data.userName || data.authorName || "";
        const emailInfo = data.userEmail || data.authorEmail || "";

        let authorName = "이름 없음";
        if (userNameInfo && emailInfo) {
            authorName = `${userNameInfo} (${emailInfo})`;
        } else if (userNameInfo) {
            authorName = userNameInfo;
        } else if (emailInfo) {
            authorName = emailInfo;
        }

        const category = data.category || "일반";

        let orgName = data.organizationName || "";
        if (!orgName && data.organizationId) {
            try {
                const orgDoc = await db.collection("organizations").doc(data.organizationId).get();
                if (orgDoc.exists) {
                    orgName = orgDoc.data()?.name || "";
                }
            } catch (e) {
                console.warn("[notifyNewFeedback] 기관명 조회 실패:", e);
            }
        }

        const finalAuthorDisplay = orgName ? `${authorName}\n${orgName}` : authorName;

        await sendDiscordAlert({
            title: `💡 🆕 사용자 의견 등록`,
            description: `새로운 사용자 의견 (피드백/문의)이 등록되었습니다.`,
            color: 16776960, // 노란색
            fields: [
                { name: "작성자", value: finalAuthorDisplay, inline: true },
                { name: "분류", value: category, inline: true },
                { name: "내용", value: message, inline: false },
            ],
        }).catch(e => console.error("Discord alert error:", e));
    }
);
