/**
 * disconnectSlack — 기관의 Slack 연결 해제 (설정 화면용)
 *
 * Slack 측 토큰 무효화(auth.revoke)를 먼저 시도한 뒤(베스트에포트),
 * 문서에서 암호화 토큰을 삭제하고 enabled:false / revoked:true로 표시한다.
 * revoke가 실패해도 로컬 토큰은 반드시 삭제한다 (재연결은 OAuth로 다시).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { SLACK_TOKEN_ENC_KEY } from "../../core/params";
import { findSlackIntegrationByOrg } from "../../services/slack/resolveSlackUser";
import { decryptSlackToken } from "../../services/slack/tokenCrypto";
import { authRevoke } from "../../services/slack/slackApi";
import type { EncryptedRecord } from "../../core/crypto";
import { log } from "../../utils/helpers";

export const disconnectSlack = onCall(
    {
        region: "asia-northeast3",
        secrets: [SLACK_TOKEN_ENC_KEY],
        timeoutSeconds: 30,
        memory: "256MiB",
        cors: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const role = request.auth.token.role as string | undefined;
        if (role !== "admin" && role !== "superAdmin") {
            throw new HttpsError("permission-denied", "기관 관리자만 연결을 해제할 수 있습니다.");
        }
        const organizationId = request.auth.token.orgId as string | undefined;
        if (!organizationId) {
            throw new HttpsError("failed-precondition", "소속 기관 정보를 확인할 수 없습니다.");
        }

        const found = await findSlackIntegrationByOrg(organizationId);
        if (!found) {
            throw new HttpsError("not-found", "연결된 Slack 워크스페이스가 없습니다.");
        }

        // 1) Slack 측 토큰 무효화 (베스트에포트 — 복호화/호출 실패해도 로컬 삭제는 진행)
        const cipher = found.data.tokenCipher as EncryptedRecord | undefined;
        if (cipher) {
            try {
                const token = decryptSlackToken(found.teamId, cipher);
                const revoked = await authRevoke(token);
                if (!revoked) {
                    log("WARNING", "disconnectSlack", "auth.revoke 실패 (로컬 삭제는 진행)", { teamId: found.teamId });
                }
            } catch (err) {
                log("WARNING", "disconnectSlack", "토큰 복호화 실패 (로컬 삭제는 진행)", { teamId: found.teamId, error: (err as Error).message });
            }
        }

        // 2) 로컬 토큰 삭제 + 비활성화
        await found.ref.update({
            tokenCipher: FieldValue.delete(),
            enabled: false,
            revoked: true,
            disconnectedBy: request.auth.uid,
            disconnectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        log("INFO", "disconnectSlack", "Slack 연결 해제 완료", { teamId: found.teamId, organizationId });
        return { success: true };
    }
);
