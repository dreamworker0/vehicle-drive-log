/**
 * getSlackConnectionStatus — 기관의 Slack 연결 상태 조회 (설정 화면용)
 *
 * integrations 문서는 Rules로 클라이언트 접근이 전면 차단돼 있으므로(봇 토큰 보관)
 * 이 콜러블이 안전 필드만 골라 반환한다. 토큰/암호문은 절대 포함하지 않는다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { findSlackIntegrationByOrg } from "../../services/slack/resolveSlackUser";

export interface SlackConnectionStatus {
    connected: boolean;
    teamName?: string | null;
    botUserId?: string | null;
    /** ISO 문자열 (연결 시각) */
    connectedAt?: string | null;
}

export const getSlackConnectionStatus = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 15,
        memory: "256MiB",
        cors: true,
    },
    async (request): Promise<SlackConnectionStatus> => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const role = request.auth.token.role as string | undefined;
        if (role !== "admin" && role !== "superAdmin") {
            throw new HttpsError("permission-denied", "기관 관리자만 조회할 수 있습니다.");
        }
        const organizationId = request.auth.token.orgId as string | undefined;
        if (!organizationId) {
            throw new HttpsError("failed-precondition", "소속 기관 정보를 확인할 수 없습니다.");
        }

        const found = await findSlackIntegrationByOrg(organizationId);
        if (!found || found.data.enabled !== true || !found.data.tokenCipher) {
            return { connected: false };
        }

        const connectedAt = found.data.connectedAt?.toDate
            ? (found.data.connectedAt.toDate() as Date).toISOString()
            : null;
        return {
            connected: true,
            teamName: (found.data.teamName as string) || null,
            botUserId: (found.data.botUserId as string) || null,
            connectedAt,
        };
    }
);
