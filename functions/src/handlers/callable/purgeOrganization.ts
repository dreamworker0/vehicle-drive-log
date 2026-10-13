/**
 * purgeOrganization — 해지된 기관을 즉시 파기한다 (superAdmin 전용)
 *
 * 슈퍼관리자 화면의 [영구 삭제]가 쓴다. 예전에는 클라이언트가 users와 기관 문서만 지워서
 * (permanentDeleteOrganization) 기관 데이터가 영구히 남았고, 기관 문서가 사라져 주간 파기
 * 배치(purgeOrgs — status·deletedAt으로 대상을 찾는다)도 그 기관을 다시는 찾지 못했다.
 * 이제 배치와 같은 purgeOrganizationData를 서버에서 바로 돌린다.
 *
 * 해지(status: deleted)된 기관만 받는다. 30일 유예는 기다리지 않는다 — 슈퍼관리자가 두 번
 * 확인하고 누르는 "되돌릴 수 없는 삭제"이기 때문이다. 기관 문서를 마지막에 지우므로 타임아웃이
 * 나도 다시 누르면 이어서 지운다(멱등).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { requireSuperAdmin } from "../../utils/helpers";
import { captureError, flushSentry } from "../../core/sentry";
import { purgeOrganizationData, OrgNotRetiredError } from "../../services/organization/purgeOrganizationData";

export const purgeOrganization = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
        enforceAppCheck: true,
    },
    async (request) => {
        requireSuperAdmin(request);

        const orgId = (request.data as { orgId?: unknown } | undefined)?.orgId;
        if (typeof orgId !== "string" || orgId.trim() === "") {
            throw new HttpsError("invalid-argument", "기관 ID가 필요합니다.");
        }

        console.log(`[purgeOrganization] 파기 시작 org=${orgId} (uid=${request.auth.uid})`);
        try {
            const summary = await purgeOrganizationData(orgId, getStorage().bucket());
            console.log(`[purgeOrganization] 파기 완료 org=${orgId}: ${JSON.stringify(summary.deleted)}`);
            return { success: true, deleted: summary.deleted };
        } catch (err: unknown) {
            if (err instanceof OrgNotRetiredError) {
                throw new HttpsError("failed-precondition", "해지된 기관만 영구 삭제할 수 있습니다.");
            }
            console.error(`[purgeOrganization] 파기 실패 org=${orgId}:`, (err as Error).message);
            captureError(err, { context: "purgeOrganization", orgId });
            await flushSentry();
            throw new HttpsError("internal", "영구 삭제 중 오류가 발생했습니다. 다시 시도하면 남은 데이터부터 이어서 지웁니다.");
        }
    },
);
