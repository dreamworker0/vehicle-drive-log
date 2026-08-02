/**
 * writeAuditEntry — 콜러블이 남기는 접속기록 공통 쓰기
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조.
 *
 * 문서 변경 로그는 Firestore 트리거(handlers/triggers/auditLog.ts)가 남기지만,
 * 트리거가 볼 수 없는 것이 둘 있다 — **접속지 IP**와 **읽기·반출 행위**다.
 * 둘 다 콜러블에서만 잡히므로 이 모듈이 그 경로의 공통 규약을 갖는다.
 *
 * 트리거 쪽과 규약을 일부러 맞춰 둔다(컬렉션·보관기간·`__system__` 기관·필드 이름).
 * 어긋나면 Phase 3의 점검 화면이 두 벌의 해석 코드를 갖게 된다.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

/** 보관 기간 — 변경 로그(auditLog 트리거)와 같은 1년 */
export const RETENTION_DAYS = 365;

/** 기관에 속하지 않는 계정(주로 superAdmin) — auditLog 트리거와 같은 규약 */
export const SYSTEM_ORG_ID = "__system__";

export interface AuditEntryInput {
    /** 문서 ID — 같은 행위의 재호출이 중복을 만들지 않도록 호출부가 결정론적으로 만든다 */
    docId: string;
    organizationId: string;
    action: "login" | "export" | "read";
    targetType: "session" | "export" | "orgDocument";
    targetId: string;
    /** 행위자. 콜러블은 인증 토큰에서 얻으므로 위조될 수 없다 */
    actorUid: string;
    /** 처리한 정보주체 uid 목록. 반출은 대상이 특정되지 않으므로 비울 수 있다 */
    subjectUids: string[];
    /** 접속지 IP (세션 기록 전용). 알 수 없으면 null */
    ip?: string | null;
    /** 브라우저·OS 수준으로 축약한 접속 환경 */
    userAgent?: string;
    /** 반출 형식·대상·건수 — **데이터 내용은 절대 담지 않는다** */
    exportFormat?: string;
    exportDataset?: string;
    recordCount?: number;
}

/**
 * 접속기록 1건을 남긴다.
 *
 * `undefined` 필드는 넣지 않는다 — Firestore가 거부하기도 하고, 없는 항목이
 * null로 남으면 "확인했는데 없음"과 "해당 없음"이 구분되지 않는다.
 */
export async function writeAuditEntry(entry: AuditEntryInput): Promise<void> {
    const db = getFirestore();
    const expiresAt = Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const doc: Record<string, unknown> = {
        organizationId: entry.organizationId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        actorUid: entry.actorUid,
        // 콜러블은 인증 컨텍스트에서 행위자를 직접 확인한다
        actorSource: "auth",
        subjectUids: entry.subjectUids,
        at: FieldValue.serverTimestamp(),
        expiresAt,
    };

    if (entry.ip !== undefined) doc.ip = entry.ip;
    if (entry.userAgent !== undefined) doc.userAgent = entry.userAgent;
    if (entry.exportFormat !== undefined) doc.exportFormat = entry.exportFormat;
    if (entry.exportDataset !== undefined) doc.exportDataset = entry.exportDataset;
    if (entry.recordCount !== undefined) doc.recordCount = entry.recordCount;

    await db.collection("auditLogs").doc(entry.docId).set(doc);
}

/**
 * 사용자 문서에서 기관 식별자를 읽는다. 없으면 시스템 기관으로 남긴다.
 * 기관 관리자의 점검 조회 필터가 되는 값이라 비워 두면 기록이 사각지대로 빠진다.
 */
export async function resolveOrgId(uid: string): Promise<string> {
    const snap = await getFirestore().collection("users").doc(uid).get();
    return (snap.data()?.organizationId as string | undefined) || SYSTEM_ORG_ID;
}
