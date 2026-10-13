/**
 * purgeOrganizationData — 해지된 기관의 데이터를 실제로 파기한다
 *
 * ## 왜 필요한가
 * 처리방침 제9조와 해지 화면은 "해지 30일 뒤 기관 데이터가 완전히 삭제된다"고 약속한다
 * (PrivacyPage.tsx·WithdrawOrgModal.tsx). 그런데 예전 purgeOrgs와 superAdmin의 영구 삭제는
 * users와 기관 문서만 지웠다. 운행일지(운전자·목적지)·예약(예약자·동승자)·차량·주유·정비·
 * 하이패스·알림·연동 정보는 기관이 사라진 뒤에도 영구히 남았다(2026-10-14 감사에서 발견).
 * 수탁자로서 위탁이 끝난 개인정보를 파기하지 않는 상태였다.
 *
 * ## 순서가 곧 안전장치다
 * - **기관 문서를 맨 마지막에 지운다.** 중간에 타임아웃·오류가 나도 기관 문서가
 *   `status: "deleted"`로 남아 있으므로 다음 실행(주간 배치 또는 재호출)이 이어서 지운다.
 *   전 과정이 멱등이다 — 이미 지운 것은 다시 조회돼도 0건이다.
 * - 운행일지·예약·충전 기록을 차량·카드보다 먼저 지운다. 삭제 트리거(onDriveLogDeleted·
 *   onHipassChargeDeleted·onReservationDeleted)는 isOrgRetired로 해지 기관이면 부수효과
 *   (하이패스 환불·누적 km 보정·캘린더 일정 삭제)를 건너뛰지만, 순서로도 한 번 더 막는다.
 * - 감사 기록(auditLogs)은 **지우지 않는다.** 접속기록은 1년 보관이 법정 요건이고(TTL로
 *   자동 만료), 값이 아니라 필드 이름만 담는다. 이 파기로 생기는 삭제 감사 기록이 곧 파기
 *   기록이 된다.
 *
 * ## 이 함수가 지우지 못하는 것 (기록해 둔다)
 * - Firestore 백업(전 기관 통합, 90일 수명 주기로 만료)과 3년 지난 운행일지 GCS 아카이브
 *   (전 기관이 한 파일에 섞여 있어 기관 단위로 지울 수 없다).
 * - uid로만 묶인 데이터(organizationId 없는 즐겨찾기·알림, Storage feedbacks/{uid}/) —
 *   users 문서가 해지 시점에 이미 지워져 기관→uid를 되찾을 정본이 없다.
 */
import { getFirestore, type Firestore, type Query } from "firebase-admin/firestore";
import { SYSTEM_ORG_ID } from "../audit/writeAuditEntry";

/** 한 번에 지우는 문서 수 — 배치 상한(500)보다 여유를 둔다 */
const DELETE_PAGE = 400;

/**
 * `organizationId`(또는 다른 기관 필드)로 묶인 컬렉션 — **지우는 순서대로** 적는다.
 * 기록류(트리거가 차량·카드를 참조) → 차량·카드 → 사용자 순이다.
 */
const ORG_SCOPED: ReadonlyArray<readonly [collection: string, field: string]> = [
    ["driveLogs", "organizationId"],
    ["reservations", "organizationId"],
    ["hipassCharges", "organizationId"],
    ["fuelLogs", "organizationId"],
    ["maintenanceRecords", "organizationId"],
    ["notifications", "organizationId"],
    ["favorites", "organizationId"],
    ["feedbacks", "organizationId"],
    ["slackOauthStates", "organizationId"],
    ["assistantConversations", "orgId"],
    // 캘린더 바인딩을 남기면 그 캘린더가 사라진 기관에 묶인 채로 남아 다른 기관이 연결할 수 없다.
    ["calendarBindings", "organizationId"],
    ["vehicles", "organizationId"],
    ["hipassCards", "organizationId"],
    // 해지 시점에 이미 지워졌지만, 그 뒤에 남은 문서가 있으면 함께 지운다.
    ["users", "organizationId"],
];

/** Slack 워크스페이스(teamId) 단위로 묶인 컬렉션 — integrations 문서에서 teamId를 얻는다 */
const SLACK_TEAM_SCOPED = ["slackUsers", "slackTasks", "slackConfirmations"] as const;

export interface PurgeBucket {
    deleteFiles(options: { prefix: string }): Promise<unknown>;
}

export interface PurgeSummary {
    orgId: string;
    /** 컬렉션별 삭제 문서 수 */
    deleted: Record<string, number>;
    storagePrefix: string;
}

/** 해지(status: deleted) 상태가 아닌 기관은 파기하지 않는다 — 호출자 실수에 대한 마지막 방어선 */
export class OrgNotRetiredError extends Error {
    constructor(orgId: string, status: unknown) {
        super(`기관 ${orgId}은(는) 해지 상태가 아니라 파기하지 않는다 (status=${String(status)})`);
        this.name = "OrgNotRetiredError";
    }
}

async function deleteByQuery(db: Firestore, query: Query): Promise<number> {
    let total = 0;
    for (;;) {
        const snap = await query.limit(DELETE_PAGE).get();
        if (snap.empty) return total;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        total += snap.size;
    }
}

/**
 * 기관 하나의 데이터를 파기한다. 기관 문서가 해지 상태(`status: "deleted"`)일 때만 진행한다.
 * 30일 유예 판정은 호출자(purgeOrgs·purgeOrganization 콜러블)의 몫이다.
 */
export async function purgeOrganizationData(
    orgId: string,
    bucket: PurgeBucket,
    db: Firestore = getFirestore(),
): Promise<PurgeSummary> {
    // 빈 값으로 where(==)를 돌리면 organizationId가 빈 문서(공개 문의 등)를 통째로 지운다.
    if (typeof orgId !== "string" || orgId.trim() === "" || orgId === SYSTEM_ORG_ID || orgId.includes("/")) {
        throw new Error(`파기할 기관 ID가 올바르지 않다: ${JSON.stringify(orgId)}`);
    }

    const orgRef = db.collection("organizations").doc(orgId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
        // 이미 끝까지 지워졌다(기관 문서는 마지막에 지운다). 할 일이 없다.
        return { orgId, deleted: {}, storagePrefix: "" };
    }
    const status = orgSnap.data()?.status;
    if (status !== "deleted") throw new OrgNotRetiredError(orgId, status);

    const deleted: Record<string, number> = {};
    const count = (key: string, n: number) => { deleted[key] = (deleted[key] ?? 0) + n; };

    for (const [collection, field] of ORG_SCOPED) {
        count(collection, await deleteByQuery(db, db.collection(collection).where(field, "==", orgId)));
    }

    // Slack 연동: 워크스페이스에 묶인 캐시·작업 큐를 먼저, 연동 문서(봇 토큰 암호문)를 마지막에.
    const integrations = await db.collection("integrations").where("organizationId", "==", orgId).get();
    for (const intg of integrations.docs) {
        const teamId = intg.data().teamId;
        if (typeof teamId === "string" && teamId !== "") {
            for (const collection of SLACK_TEAM_SCOPED) {
                count(collection, await deleteByQuery(db, db.collection(collection).where("teamId", "==", teamId)));
            }
        }
        await intg.ref.delete();
        count("integrations", 1);
    }

    // 기관 ID를 문서 ID로 쓰는 것들
    await db.collection("assistantVehicleCache").doc(orgId).delete();
    // 월별 집계(운전자별 이름 포함)와 그 부모 문서
    await db.recursiveDelete(db.collection("orgStats").doc(orgId));

    // 증빙 서류(사업자등록증 등) 이미지 — cleanupImages는 승인·반려 기관만 정리해 해지 기관 것은 남았다.
    const storagePrefix = `organizations/${orgId}/`;
    await bucket.deleteFiles({ prefix: storagePrefix });

    // 마지막: 기관 문서와 그 하위 컬렉션(customHolidays·preRegistered·stats).
    // 문서 delete는 하위 컬렉션을 지우지 않으므로 recursiveDelete를 쓴다.
    await db.recursiveDelete(orgRef);
    count("organizations", 1);

    return { orgId, deleted, storagePrefix };
}
