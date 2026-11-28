/**
 * manageExternalApiKey — 외부 연동(API) 키 상태 조회·발급·폐기 (기관 관리자)
 *
 * 키 컬렉션(externalApiKeys)은 Rules로 클라이언트 접근이 전부 막혀 있어 설정 화면은 이 콜러블로만
 * 키를 다룬다. 원래 키 값은 **발급 응답에서 한 번만** 돌려주고 어디에도 저장하지 않는다.
 *
 * - status: 지금 살아 있는 키의 끝 4자리·발급 시각·마지막 사용 시각
 * - issue:  새 키 발급. 기존 키는 함께 지운다(기관당 하나). 기관이 [외부 연동(API)]을 켰을 때만
 * - revoke: 기관의 키를 모두 지운다. 토글이 꺼져 있어도 폐기는 된다(끈 뒤 정리하는 경로)
 *
 * 권한은 커스텀 클레임(`role`·`orgId`)으로 본다 — Rules와 같은 근거(regenerateInviteCode와 같다).
 *
 * 발급·교체·폐기는 **접속기록(auditLogs)에 남긴다** — 같은 배치로 커밋해 키만 바뀌고 기록이
 * 빠지는 일이 없다. 키는 기관 데이터를 기관 밖으로 내보내는 열쇠라, 누가 언제 만들고 없앴는지가
 * 점검 대상이다(2026-11-28 보안 재점검). 키 값·해시·끝 4자리는 기록하지 않는다.
 */
import { randomUUID } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import { wrapCallableHandler } from "../../utils/helpers";
import { buildAuditEntryDoc } from "../../services/audit/writeAuditEntry";
import {
    API_KEYS_COLLECTION,
    apiKeyHint,
    generateApiKey,
    hashApiKey,
    type ApiKeyDoc,
} from "../../services/externalApi/apiKeys";

type Action = "status" | "issue" | "revoke";

interface ManageExternalApiKeyRequest {
    action?: unknown;
}

export interface ExternalApiKeyStatus {
    hasKey: boolean;
    /** 끝 4자리 */
    hint?: string | null;
    /** ISO 문자열 */
    createdAt?: string | null;
    /** ISO 문자열. 한 번도 안 쓰였으면 null */
    lastUsedAt?: string | null;
}

export interface ManageExternalApiKeyResponse {
    status: ExternalApiKeyStatus;
    /** issue일 때만 — 지금 한 번만 보여 줄 원래 키 */
    apiKey?: string;
}

const ACTIONS: ReadonlySet<string> = new Set<Action>(["status", "issue", "revoke"]);

function toIso(value: unknown): string | null {
    return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

/**
 * 키 변경 기록을 배치에 얹는다. 대상 ID는 기관 ID다(기관당 키는 하나).
 * 첫 발급 = create, 교체 = update(바뀐 항목 apiKey), 폐기 = delete.
 */
function addKeyAudit(
    db: Firestore,
    batch: WriteBatch,
    organizationId: string,
    actorUid: string,
    action: "create" | "update" | "delete",
): void {
    const docId = `externalApiKey_${organizationId}_${randomUUID()}`;
    batch.set(db.collection("auditLogs").doc(docId), buildAuditEntryDoc({
        docId,
        organizationId,
        action,
        targetType: "externalApiKey",
        targetId: organizationId,
        actorUid,
        subjectUids: [],
        ...(action === "update" ? { changedFields: ["apiKey"] } : {}),
    }));
}

export const manageExternalApiKey = onCall(
    // 관리자 설정 화면(InAppBrowserGuard 안쪽)에서만 호출되므로 App Check 토큰을 항상 기대할 수 있다.
    { region: "asia-northeast3", enforceAppCheck: true, timeoutSeconds: 15, memory: "256MiB" },
    wrapCallableHandler<ManageExternalApiKeyRequest, ManageExternalApiKeyResponse>(
        "manageExternalApiKey",
        { rateLimitKey: "manageExternalApiKey" },
        async (request) => {
            const action = request.data?.action;
            if (typeof action !== "string" || !ACTIONS.has(action)) {
                throw new HttpsError("invalid-argument", "action은 status·issue·revoke 중 하나여야 합니다.");
            }

            // wrapCallableHandler가 인증을 먼저 확인하므로 auth는 존재한다.
            const token = request.auth!.token as { role?: unknown; orgId?: unknown };
            const organizationId = typeof token.orgId === "string" ? token.orgId : "";
            if (token.role !== "admin" && token.role !== "superAdmin") {
                throw new HttpsError("permission-denied", "기관 관리자만 외부 연동 키를 관리할 수 있습니다.");
            }
            if (!organizationId) {
                throw new HttpsError("failed-precondition", "소속 기관 정보를 확인할 수 없습니다.");
            }

            const db = getFirestore();
            const keysQuery = db.collection(API_KEYS_COLLECTION).where("organizationId", "==", organizationId);

            if (action === "status") {
                const snap = await keysQuery.get();
                // 기관당 하나지만, 혹시 여럿이면 가장 최근 것을 보여 준다
                const docs = [...snap.docs].sort((a, b) =>
                    (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0));
                const latest = docs[0]?.data();
                return {
                    status: latest
                        ? {
                            hasKey: true,
                            hint: typeof latest.hint === "string" ? latest.hint : null,
                            createdAt: toIso(latest.createdAt),
                            lastUsedAt: toIso(latest.lastUsedAt),
                        }
                        : { hasKey: false },
                };
            }

            if (action === "revoke") {
                const snap = await keysQuery.get();
                // 지울 키가 없으면 아무 일도 없었으므로 기록하지 않는다
                if (snap.docs.length === 0) return { status: { hasKey: false } };
                const batch = db.batch();
                snap.docs.forEach((doc) => batch.delete(doc.ref));
                addKeyAudit(db, batch, organizationId, request.auth!.uid, "delete");
                await batch.commit();
                return { status: { hasKey: false } };
            }

            // issue — 기관이 기능을 켰을 때만 (화면만 숨기지 않고 서버도 같은 기준으로 막는다)
            const orgSnap = await db.collection("organizations").doc(organizationId).get();
            const org = orgSnap.data();
            if (!orgSnap.exists || org?.status !== "approved") {
                throw new HttpsError("failed-precondition", "승인된 기관만 외부 연동 키를 발급할 수 있습니다.");
            }
            if (org.externalApiEnabled !== true) {
                throw new HttpsError("failed-precondition", "설정 › 기능 사용에서 [외부 연동(API)]을 먼저 켜 주세요.");
            }

            const apiKey = generateApiKey();
            const hint = apiKeyHint(apiKey);
            const existing = await keysQuery.get();
            const batch = db.batch();
            existing.docs.forEach((doc) => batch.delete(doc.ref));
            const newDoc: ApiKeyDoc = {
                organizationId,
                hint,
                createdByUid: request.auth!.uid,
                createdAt: FieldValue.serverTimestamp(),
                lastUsedAt: null,
            };
            // create: 해시가 겹치는 일은 사실상 없지만, 겹치면 덮어쓰지 않고 실패하게 한다
            batch.create(db.collection(API_KEYS_COLLECTION).doc(hashApiKey(apiKey)), newDoc);
            addKeyAudit(db, batch, organizationId, request.auth!.uid, existing.docs.length === 0 ? "create" : "update");
            await batch.commit();

            return {
                apiKey,
                status: { hasKey: true, hint, createdAt: new Date().toISOString(), lastUsedAt: null },
            };
        },
    ),
);
