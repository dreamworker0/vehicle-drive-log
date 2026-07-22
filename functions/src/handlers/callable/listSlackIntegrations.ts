/**
 * listSlackIntegrations — 전체 Slack 연결 기관 현황 (슈퍼관리자 대시보드용)
 *
 * integrations 문서는 Rules로 클라이언트 접근이 전면 차단돼 있으므로(봇 토큰 보관)
 * 이 콜러블이 안전 필드만 골라 반환한다. 토큰/암호문은 절대 포함하지 않는다.
 * platform == "slack" 단일 equality 조회라 복합 인덱스가 필요 없다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export interface SlackIntegrationSummary {
    organizationId: string;
    organizationName: string | null;
    /** Slack 워크스페이스 이름 */
    teamName: string | null;
    botUserId: string | null;
    /** enabled && !revoked — 현재 활성 연결 여부 */
    active: boolean;
    /** ISO 문자열 (연결 시각) */
    connectedAt: string | null;
    /** ISO 문자열 (해제 시각, 해제된 경우) */
    disconnectedAt: string | null;
}

export interface SlackIntegrationsResult {
    integrations: SlackIntegrationSummary[];
    /** 현재 활성 연결 기관 수 */
    activeCount: number;
}

export const listSlackIntegrations = onCall(
    { region: "asia-northeast3", timeoutSeconds: 30, memory: "256MiB", enforceAppCheck: true },
    async (request): Promise<SlackIntegrationsResult> => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        const db = getFirestore();
        const userDoc = await db.collection("users").doc(request.auth.uid).get();
        const userData = userDoc.data();
        if (!userData || userData.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "superAdmin 권한이 필요합니다.");
        }

        const snap = await db.collection("integrations")
            .where("platform", "==", "slack")
            .get();

        // 연결 기관명 조인 — 연결 기관 수는 소규모라 개별 read로 충분
        const integrations = await Promise.all(snap.docs.map(async (doc) => {
            const data = doc.data();
            const organizationId = (data.organizationId as string) || "";
            let organizationName: string | null = null;
            if (organizationId) {
                const orgSnap = await db.collection("organizations").doc(organizationId).get();
                organizationName = (orgSnap.data()?.name as string) || null;
            }
            const toIso = (ts: FirebaseFirestore.Timestamp | undefined) =>
                ts?.toDate ? (ts.toDate() as Date).toISOString() : null;
            return {
                organizationId,
                organizationName,
                teamName: (data.teamName as string) || null,
                botUserId: (data.botUserId as string) || null,
                active: data.enabled === true && data.revoked !== true,
                connectedAt: toIso(data.connectedAt),
                disconnectedAt: toIso(data.disconnectedAt),
            };
        }));

        // 활성 우선, 그다음 연결일 최신순
        integrations.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return (b.connectedAt || "").localeCompare(a.connectedAt || "");
        });

        return {
            integrations,
            activeCount: integrations.filter((i) => i.active).length,
        };
    }
);
