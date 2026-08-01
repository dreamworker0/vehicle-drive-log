/**
 * auditLog — 개인정보 담은 문서의 변경 로그 (Firestore 트리거)
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조(접속기록의 보관 및 점검).
 *
 * ## 왜 트리거인가
 * 클라이언트가 기록하면 로그를 남기지 않고 조작하는 우회가 가능하다. 트리거는 Firestore
 * 쓰기가 곧 이벤트이므로 클라이언트가 기록을 건너뛸 수 없고, Admin SDK로 쓰므로 위조도
 * 할 수 없다. 단 "누락이 불가능"한 것은 아니다 — 아래 유실 대책 참고.
 *
 * ## 왜 기존 트리거(syncDriveLogKm)에 얹지 않는가
 * 감사 로그 쓰기가 실패할 때 차량 누적 Km 동기화라는 핵심 로직까지 같이 죽는다.
 *
 * ## 무엇을 기록하는가 — 화이트리스트
 * **개인정보 필드와 접근 권한 필드의 변경만** 기록한다(AUDITED_FIELDS). 블랙리스트가 아니라
 * 화이트리스트인 이유가 셋 있다.
 *
 * 1. `syncNextLogStartKm`의 연쇄 동기화는 한 번의 정정으로 뒤 기록 전체의 startKm/endKm을
 *    다시 쓴다(기록이 많은 차량이면 수백~수천 건). 이를 그대로 기록하면 사람의 편집 몇 건이
 *    시스템 파급 수백 건에 묻혀 제16조 ②의 점검이 실질적으로 불가능해진다. km은 차량 자산
 *    데이터이지 개인정보가 아니므로 화이트리스트에서 자연히 빠진다.
 *    (연쇄가 트리거를 타고 20건 단위로 증폭되던 문제는 별건으로 해소했다 — 연쇄 쓰기에
 *    `kmSyncRev`를 올려 재발동을 끊는다. 쓰기 건수 자체는 데이터 모델상 남는다.)
 * 2. driveLogs create 규칙은 `hasAll`만 검사해 `hasOnly`가 없다. 즉 클라이언트가 임의
 *    이름의 필드를 넣을 수 있고, 블랙리스트 방식이면 그 필드명이 그대로 로그에 들어온다.
 *    필드명에 개인정보를 담아(`"홍길동-010-1234-5678"`) 삭제 불가능한 컬렉션에 1년간
 *    박아 넣는 오염 경로가 열린다. 화이트리스트는 이 경로를 원천 차단한다.
 * 3. 다크모드 토글(theme)·환영 배너 닫기(welcomeDismissed)·FCM 토큰 회전(fcmToken)은
 *    개인정보 처리 행위가 아니다. 기록할 근거가 없고(최소수집) 점검 화면만 어지럽힌다.
 *
 * ## 유실 대책 — retry + 멱등
 * v2 Firestore 트리거의 기본값은 `retry: false`라 함수가 실패하면 이벤트가 폐기된다.
 * 법정 기록이므로 `retry: true`로 재전달을 받고, 문서 ID를 `대상_ID_이벤트ID`로 고정해
 * 재시도가 중복을 만들지 않게 한다(`add()`는 매번 새 ID라 retry를 켤 수 없는 구조였다).
 * 실패는 ERROR 로그(Sentry)로 남기고 **다시 throw해** 플랫폼 재시도에 맡긴다. 이 트리거의
 * 실패는 원본 문서 쓰기를 되돌리지 않는다 — Firestore 트리거는 커밋 이후에 실행된다.
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

/**
 * 기관에 속하지 않는 문서(주로 superAdmin 계정)의 기관 식별자.
 *
 * 예전에는 organizationId가 없으면 기록을 건너뛰었다. 그 결과 **시스템 전체 접근 권한을
 * 가진 superAdmin 계정의 생성·권한 변경·삭제가 한 줄도 남지 않았다** — 가장 위험한 계정이
 * 정확히 감시 사각지대였다. 실재하지 않는 기관 ID를 쓰면 기관 관리자의 조회
 * (`isOrgAdmin(resource.data.organizationId)`)에는 절대 걸리지 않고 superAdmin만 볼 수 있다.
 */
const SYSTEM_ORG_ID = "__system__";

/**
 * 트리거 공통 옵션.
 * `retry: true` — 실패한 이벤트를 폐기하지 않고 재전달받는다(멱등 문서 ID와 함께 동작).
 */
const TRIGGER_OPTS = { region: "asia-northeast3", memory: "256MiB" as const, retry: true };

type AuditAction = "create" | "update" | "delete";
type AuditTargetType = "driveLog" | "user";

/**
 * 기록 대상 필드 화이트리스트 — 개인정보 필드와 접근 권한 필드만.
 *
 * 여기 없는 필드의 변경은 기록되지 않는다. 필드를 추가할 때는 "이 필드가 정보주체의
 * 개인정보이거나 접근 권한인가"를 기준으로 판단한다. km·연료·하이패스·배터리·차량 정보는
 * 자산 데이터이므로 제외한다.
 */
const AUDITED_FIELDS: Record<AuditTargetType, ReadonlySet<string>> = {
    driveLog: new Set([
        "organizationId",       // 기관 이전
        "driverUid", "driverName", "createdByUid",
        "coDriverUids", "coDriverNames",
        "passengerNames",       // 탑승자 이름(외부 이용자 포함)
        "date", "startLocation", "destination", "purpose", "notes",
    ]),
    user: new Set([
        "organizationId", "organizationStatus",
        "name", "email", "phone", "photoURL",
        "role", "status",       // 접근 권한 — 고시 제5조가 별도로 요구하는 항목
        // 약관·처리방침 동의 기록(#91~#93에서 도입). 동의 철회·재동의는 처리 근거의
        // 변동이므로 필드가 들어오는 시점부터 자동으로 기록되게 미리 넣어 둔다.
        "consent",
    ]),
};

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
 * 문서 ID를 `대상타입_대상ID_이벤트ID`로 고정해 재시도가 중복을 만들지 않게 한다.
 * 실패는 ERROR 로그를 남기고 **다시 throw한다** — 폐기하면 법정 기록이 조용히 사라진다.
 */
async function writeAuditLog(entry: AuditEntry, eventId: string): Promise<void> {
    // Firestore 문서 ID에는 '/'를 쓸 수 없다.
    const docId = `${entry.targetType}_${entry.targetId}_${eventId}`.replace(/\//g, "_");

    try {
        const db = getFirestore();
        const expiresAt = Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

        await db.collection("auditLogs").doc(docId).set({
            ...entry,
            at: FieldValue.serverTimestamp(),
            expiresAt,
        });
    } catch (err: unknown) {
        log("ERROR", "auditLog", "감사 로그 기록 실패 — 재시도에 맡긴다", {
            targetType: entry.targetType,
            targetId: entry.targetId,
            action: entry.action,
            error: (err as Error).message,
        });
        throw err;
    }
}

/**
 * 화이트리스트에 든 필드 중 변경된 것의 **이름만** 뽑는다. 값은 담지 않는다.
 *
 * 값을 남기면 감사 로그가 개인정보 스냅샷이 되어 그 로그도 보호 대상이 되는 순환에 빠진다.
 * 다툼이 되는 것은 "누가 언제 무엇을 고쳤는가"이고 값 자체는 원본 문서에 있다.
 */
function diffFieldNames(
    targetType: AuditTargetType,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined
): string[] {
    if (!before || !after) return [];
    const changed: string[] = [];

    for (const key of AUDITED_FIELDS[targetType]) {
        // Firestore 값은 Timestamp·배열·맵이 섞이므로 JSON 비교로 충분한 근사를 취한다.
        // 목적은 "어떤 필드가 건드려졌는가"이지 정확한 값 비교가 아니다.
        // 직렬화 불가능한 값(순환 참조 등)이 들어오면 핸들러 전체를 죽이지 않고 변경으로 본다.
        try {
            if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
        } catch {
            changed.push(key);
        }
    }
    return changed.sort();
}

/**
 * 운행일지의 정보주체 — 대표 운전자와 공동 운전자.
 *
 * `passengerNames`(외부 탑승자 포함)는 **일부러 넣지 않는다.** 탑승자는 uid 없이 이름만
 * 저장되므로 여기에 넣으면 감사 로그 자체가 이름을 담게 되어 최소수집에 반한다. 탑승자
 * 관련 변경은 `changedFields`에 필드명으로만 남는다.
 */
function driveLogSubjects(data: Record<string, unknown> | undefined): string[] {
    if (!data) return [];
    const subjects = new Set<string>();
    if (typeof data.driverUid === "string") subjects.add(data.driverUid);
    if (Array.isArray(data.coDriverUids)) {
        for (const uid of data.coDriverUids) if (typeof uid === "string") subjects.add(uid);
    }
    return [...subjects];
}

/** 기관 식별자를 정규화한다. 소속이 없으면 시스템 기관으로 남긴다(기록 누락 방지). */
function orgIdOf(...candidates: unknown[]): string {
    for (const c of candidates) {
        if (typeof c === "string" && c) return c;
    }
    return SYSTEM_ORG_ID;
}

// ── 운행일지 ──
// 운전자·동승자·탑승자 이름과 목적지를 담으므로 개인정보처리시스템의 핵심 대상이다.

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
            organizationId: orgIdOf(data.organizationId),
            action: "create",
            targetType: "driveLog",
            targetId: event.params.logId,
            actorUid,
            actorSource: actorUid ? "document" : "unknown",
            subjectUids: driveLogSubjects(data),
        }, event.id);
    }
);

export const auditDriveLogUpdated = onDocumentUpdated(
    { document: "driveLogs/{logId}", ...TRIGGER_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!after) return;

        const changedFields = diffFieldNames("driveLog", before, after);
        // 개인정보·권한 필드가 안 바뀐 쓰기는 기록하지 않는다 (km 연쇄 동기화 등).
        if (changedFields.length === 0) return;

        await writeAuditLog({
            // 기관 이전은 이전 소속 기준으로 남긴다 — 그 기관의 점검 대상이다.
            organizationId: orgIdOf(before?.organizationId, after.organizationId),
            action: "update",
            targetType: "driveLog",
            targetId: event.params.logId,
            // 수정자는 트리거가 알 수 없다 (Phase 2)
            actorUid: null,
            actorSource: "unknown",
            subjectUids: driveLogSubjects(after),
            changedFields,
        }, event.id);
    }
);

export const auditDriveLogDeleted = onDocumentDeleted(
    { document: "driveLogs/{logId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        await writeAuditLog({
            organizationId: orgIdOf(data.organizationId),
            action: "delete",
            targetType: "driveLog",
            targetId: event.params.logId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: driveLogSubjects(data),
        }, event.id);
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

        // 사용자 문서를 만드는 경로는 둘이다.
        //  - 본인 가입(joinOrganization): Rules가 본인 문서만 만들게 강제하므로 본인 행위다.
        //  - 관리자 복원(restoreUser): superAdmin/관리자가 **타인** 문서를 재생성한다.
        //    이 경우 본인을 행위자로 적으면 무고한 사용자에게 책임이 귀속된다.
        //    restoreUser가 남기는 restoredAt으로 두 경로를 가른다.
        const isRestored = data.restoredAt != null;
        const actorUid = isRestored ? null : event.params.userId;

        await writeAuditLog({
            organizationId: orgIdOf(data.organizationId),
            action: "create",
            targetType: "user",
            targetId: event.params.userId,
            actorUid,
            actorSource: actorUid ? "document" : "unknown",
            subjectUids: [event.params.userId],
        }, event.id);
    }
);

export const auditUserUpdated = onDocumentUpdated(
    { document: "users/{userId}", ...TRIGGER_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!after) return;

        const changedFields = diffFieldNames("user", before, after);
        if (changedFields.length === 0) return;

        await writeAuditLog({
            // 기관 이전(탈퇴 후 재가입)은 이전 소속 기준으로 남긴다 — 그 기관의 점검 대상이다.
            organizationId: orgIdOf(before?.organizationId, after.organizationId),
            action: "update",
            targetType: "user",
            targetId: event.params.userId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: [event.params.userId],
            changedFields,
        }, event.id);
    }
);

export const auditUserDeleted = onDocumentDeleted(
    { document: "users/{userId}", ...TRIGGER_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        await writeAuditLog({
            organizationId: orgIdOf(data.organizationId),
            action: "delete",
            targetType: "user",
            targetId: event.params.userId,
            actorUid: null,
            actorSource: "unknown",
            subjectUids: [event.params.userId],
        }, event.id);
    }
);
