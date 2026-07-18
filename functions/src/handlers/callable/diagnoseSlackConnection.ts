/**
 * diagnoseSlackConnection — Slack 연결 진단 (직원 준비 상태 리포트)
 *
 * 봇 사용의 최다 실패 원인은 "직원 Slack 이메일 ≠ 앱 가입 이메일"이다.
 * 이 콜러블은 워크스페이스 사용자 이메일(users.list)과 기관 직원 이메일을 대조해
 * 관리자가 연결 직후 누가 준비됐는지 한눈에 보게 한다. 토큰이 실제로 동작해야
 * 응답이 오므로 "연결 테스트"를 겸한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { SLACK_TOKEN_ENC_KEY } from "../../core/params";
import { findSlackIntegrationByOrg } from "../../services/slack/resolveSlackUser";
import { decryptSlackToken } from "../../services/slack/tokenCrypto";
import { listSlackEmails } from "../../services/slack/slackApi";
import type { EncryptedRecord } from "../../core/crypto";

const db = getFirestore();

export interface StaffReadiness {
    name: string;
    email: string;
    /** Slack 워크스페이스에 같은 이메일 계정이 존재하는가 */
    matched: boolean;
}

export const diagnoseSlackConnection = onCall(
    {
        region: "asia-northeast3",
        secrets: [SLACK_TOKEN_ENC_KEY],
        timeoutSeconds: 30,
        memory: "256MiB",
        cors: true,
    },
    async (request): Promise<{ ok: boolean; staff: StaffReadiness[] }> => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const role = request.auth.token.role as string | undefined;
        if (role !== "admin" && role !== "superAdmin") {
            throw new HttpsError("permission-denied", "기관 관리자만 진단할 수 있습니다.");
        }
        const organizationId = request.auth.token.orgId as string | undefined;
        if (!organizationId) {
            throw new HttpsError("failed-precondition", "소속 기관 정보를 확인할 수 없습니다.");
        }

        const found = await findSlackIntegrationByOrg(organizationId);
        const cipher = found?.data.tokenCipher as EncryptedRecord | undefined;
        if (!found || found.data.enabled !== true || !cipher) {
            throw new HttpsError("failed-precondition", "연결된 Slack 워크스페이스가 없습니다. 먼저 연결해주세요.");
        }

        let token: string;
        try {
            token = decryptSlackToken(found.teamId, cipher);
        } catch {
            throw new HttpsError("internal", "저장된 토큰을 확인할 수 없습니다. 연결을 해제하고 다시 연결해주세요.");
        }

        // 1) 워크스페이스 이메일 수집 — 실패하면 토큰이 죽은 것(연결 테스트 실패)
        const slack = await listSlackEmails(token);
        if (!slack.ok) {
            throw new HttpsError("unavailable", "Slack 응답을 받지 못했습니다. 연결을 해제하고 다시 연결해주세요.");
        }

        // 2) 기관 활성 직원과 이메일 대조 (직원 수가 적어 전량 조회 후 필터)
        const usersSnap = await db.collection("users")
            .where("organizationId", "==", organizationId)
            .get();
        const staff: StaffReadiness[] = usersSnap.docs
            .map((d) => d.data())
            .filter((u) => u.status !== "disabled" && u.email)
            .map((u) => ({
                name: (u.name as string) || String(u.email).split("@")[0],
                email: String(u.email),
                matched: slack.emails.has(String(u.email).toLowerCase()),
            }))
            .sort((a, b) => Number(a.matched) - Number(b.matched) || a.name.localeCompare(b.name, "ko"));

        return { ok: true, staff };
    }
);
