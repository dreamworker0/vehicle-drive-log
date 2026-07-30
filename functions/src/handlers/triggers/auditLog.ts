/**
 * auditLog — 개인정보 담은 문서의 변경 로그 (Firestore 트리거)
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조(접속기록의 보관 및 점검).
 *
 * ## 왜 트리거인가
 * 클라이언트가 기록하면 로그를 남기지 않고 조작하는 우회가 가능하다. 트리거는 Firestore
 * 쓰기가 곧 이벤트이므로 누락이 불가능하고, Admin SDK로 쓰므로 클라이언트가 위조할 수 없다.
 *
 * ## 왜 기존 트리거(syncDriveLogKm)에 얹지 않는가
 * 감사 로그 쓰기가 실패할 때 차량 누적 Km 동기화라는 핵심 로직까지 같이 죽는다.
 * 호출 수가 2배가 되지만 하루 1,000건 규모라 무료 한도(월 200만) 대비 무의미한 비용이다.
 *
 * ## 행위자(actorUid) 한계
 * Firestore 트리거는 호출자를 알 수 없다. 문서가 스스로 드러내는 경우에만 채우고
 * 그 외에는 null + actorSource:'unknown'으로 남겨 신뢰 수준을 구분한다.
 * 수정·삭제 행위자 식별은 Phase 2(열람 로그·세션 기록)에서 처리한다.
 */
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { log } from "../../utils/helpers";

/** 보관 기간 — 고시 제16조 기본값 1년 */
const RETENTION_DAYS = 365;

/** 트리거 공통 옵션 */
const TRIGGER_OPTS = { region: "asia-northeast3", memory: "256MiB" as const };

type AuditAction = "create" | "update" | "delete";
type AuditTargetType = "driveLog" | "user";

interface AuditEntry {
    organizationId: string;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    actorUid: string | null;
    actorSource: "document" | "unknown";
    subjectUids: string[];
    changedFields?: string[];
}

/**
 * 감사 로그를 기록한다.
 *
 * 실패해도 절대 throw하지 않는다 — 감사 로그 쓰기 실패가 원본 문서의 변경을
 * 되돌리거나 다른 트리거를 재시도시키면 안 된다. 실패는 ERROR 로그로만 남긴다.
 */
async function writeAuditLog(entry: AuditEntry): Promise<void> {
    // 기관을 특정할 수 없는 문서는 기록하지 않는다 — 멀티테넌트 조회에서 고아가 된다.
    if (!entry.organizationId) return;

    try {
        const db = getFirestore();
        const expiresAt = Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

        await db.collection("auditLogs").add({
            ...entry,
            at: FieldValue.serverTimestamp(),
            expiresAt,
        });
    } catch (err: unknown) {
        log("ERROR", "auditLog", "감사 로그 기록 실패", {
            targetType: entry.targetType,
            targetId: entry.targetId,
            action: entry.action,
            error: (err as Error).message,
        });
    }
}

/**
 * 변경된 최상위 필드명 목록을 뽑는다. **값은 담지 않는다.**
 *
 * 값을 남기면 감사 로그가 개인정보 스냅샷이 되어 그 로그도 보호 대상이 되는 순환에 빠진다.
 * editedAt/updatedAt처럼 쓰기마다 바뀌는 메타 필드는 제외해야 실제 변경만 남는다.
 */
const META_FIELDS = new Set(["editedAt", "updatedAt", "restoredAt"]);

function diffFieldNames(
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined
): string[] {
    if (!before || !after) return [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];

    for (const key of keys) {
        if (META_FIELDS.has(key)) continue;
        // Firestore 값은 Timestamp·배열·맵이 섞이므로 JSON 비교로 충분한 근사를 취한다.
        // 목적은 "어떤 필드가 건드려졌는가"이지 정확한 값 비교가 아니다.
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
    }
    return changed.sort();
}

/** 운행일지의 정보주체 — 대표 운전자와 공동 운전자(조직원으로 매칭된 uid만) */
function driveLogSubjects(data: Record<string, unknown> | undefined): string[] {
    if (!data) return [];
    const subjects = new Set<string>();
    if (typeof data.driverUid === "string") subjects.add(data.driverUid);
    if (Array.isArray(data.coDriverUids)) {
        for (const uid of data.coDriverUids) if (typeof uid === "string") subjects.add(uid);
    }
    return [...subjects];
}

// ── 운행일지 ──
// 운전자·동승자 이름과 목적지를 담으므로 개인정보처리시스템의 핵심 대상이다.

export const auditDriveLogCreated = onDocumentCreated(
    { document: "driveLogs/{logId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        // 작성자 uid는 문서에 남아 있다(규칙 소유자 판정용). 없으면 대표 운전자로 대체한다.
        const actorUid =
            typeof data.createdByUid === "string" ? data.createdByUid
                : typeof data.driverUid === "string" ? data.driverUid
                    : null;

        await writeAuditLog({
            organizationId: String(data.organizationId || ""),
            action: "create",
            targetType: "driveLog",
            targetId: event.params.logId,
            actorUid,
            actorSource: actorUid ? "document" : "unknown",
            subjectUids: driveLogSubjects(data),
        });
    }
);

export const auditDriveLogUpdated = onDocumentUpdated(
    { document: "driveLogs/{logId}", ...TRIGGER_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!after) return;

        const changedFields = diffFieldNames(before, after);
        // 메타 필드만 바뀐 쓰기는 기록하지 않는다 — 트리거 연쇄나 재저장으로 로그가 불어난다.
        if (changedFields.length === 0) return;

        await writeAuditLog({
            organizationId: String(after.organizationId || ""),
            action: "update",
            targetType: "driveLog",
            targetId: event.params.logId,
            // 수정자는 트리거가 알 수 없다 (Phase 2)
            actorUid: null,
            actorSource: "unknown",
            subjectUids: driveLogSubjects(after),
            changedFields,
        });
    }
);

export const auditDriveLogDeleted = onDocumentDeleted(
    { document: "driveLogs/{logId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        await writeAuditLog({
            organizationId: String(data.organizationId || ""),
            action: "delete",
            targetType: "driveLog",
            targetId: event.params.logId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: driveLogSubjects(data),
        });
    }
);

// ── 사용자 ──
// 직원 개인정보(이름·이메일·전화)와 접근 권한(role·status)을 담는다.
// 권한 부여·변경·말소 기록은 고시 제5조가 별도로 요구하는 항목이기도 하다.

export const auditUserCreated = onDocumentCreated(
    { document: "users/{userId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        await writeAuditLog({
            organizationId: String(data.organizationId || ""),
            action: "create",
            targetType: "user",
            targetId: event.params.userId,
            // 가입은 본인 행위다 (joinOrganization이 본인 uid로 문서를 만든다)
            actorUid: event.params.userId,
            actorSource: "document",
            subjectUids: [event.params.userId],
        });
    }
);

export const auditUserUpdated = onDocumentUpdated(
    { document: "users/{userId}", ...TRIGGER_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!after) return;

        const changedFields = diffFieldNames(before, after);
        if (changedFields.length === 0) return;

        await writeAuditLog({
            // 기관 이전(탈퇴 후 재가입)은 이전 소속 기준으로 남긴다 — 그 기관의 점검 대상이다.
            organizationId: String(before?.organizationId || after.organizationId || ""),
            action: "update",
            targetType: "user",
            targetId: event.params.userId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: [event.params.userId],
            changedFields,
        });
    }
);

export const auditUserDeleted = onDocumentDeleted(
    { document: "users/{userId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        await writeAuditLog({
            organizationId: String(data.organizationId || ""),
            action: "delete",
            targetType: "user",
            targetId: event.params.userId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: [event.params.userId],
        });
    }
);
