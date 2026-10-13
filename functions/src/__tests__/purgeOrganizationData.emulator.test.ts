/**
 * purgeOrganizationData 에뮬레이터 통합 테스트
 *
 * 기관 파기는 되돌릴 수 없는 대량 삭제다. 실제 Firestore 에뮬레이터에서 다음을 고정한다:
 * - 해지 기관(org-gone)의 데이터는 컬렉션·하위 컬렉션·연동 캐시까지 전부 지워진다
 * - **다른 기관(org-live)의 데이터는 한 건도 지워지지 않는다**
 * - 기관 필드가 빈 문서(공개 문의 등)는 건드리지 않는다
 * - 감사 기록(auditLogs)은 1년 보관 요건이라 남긴다
 * - 해지 상태가 아닌 기관은 아무것도 지우지 않고 거부한다
 */
import { initializeTestApp, clearFirestoreData, getTestFirestore } from "./emulator.setup";
import { purgeOrganizationData, OrgNotRetiredError } from "../services/organization/purgeOrganizationData";

initializeTestApp();

const db = getTestFirestore();

const GONE = "org-gone";
const LIVE = "org-live";

/** 두 기관에 같은 모양의 데이터를 심는다 */
async function seedOrg(orgId: string, status: string, teamId: string) {
    await db.collection("organizations").doc(orgId).set({ name: orgId, status, deletedAt: new Date(0) });
    await db.collection("organizations").doc(orgId).collection("customHolidays").doc("h1").set({ date: "2026-10-09" });
    await db.collection("organizations").doc(orgId).collection("preRegistered").doc("p1").set({ name: "예비직원", email: "p@test.kr" });
    await db.collection("organizations").doc(orgId).collection("stats").doc("aggregate").set({ totalDistance: 10 });

    const byOrg = ["driveLogs", "reservations", "hipassCharges", "fuelLogs", "maintenanceRecords",
        "notifications", "favorites", "feedbacks", "slackOauthStates", "calendarBindings", "vehicles", "hipassCards", "users"];
    for (const collection of byOrg) {
        await db.collection(collection).doc(`${orgId}-${collection}-1`).set({ organizationId: orgId, name: "개인정보" });
        await db.collection(collection).doc(`${orgId}-${collection}-2`).set({ organizationId: orgId, name: "개인정보" });
    }
    await db.collection("assistantConversations").doc(`slack_${teamId}_U1`).set({ orgId, slots: { destination: "시청" } });
    await db.collection("assistantVehicleCache").doc(orgId).set({ vehicles: [] });
    await db.collection("orgStats").doc(orgId).set({ staleMonths: [] });
    await db.collection("orgStats").doc(orgId).collection("monthly").doc("2026-09").set({ driverStats: { u1: { name: "운전자" } } });

    await db.collection("integrations").doc(`slack_${teamId}`).set({ platform: "slack", teamId, organizationId: orgId, tokenCipher: "x" });
    await db.collection("slackUsers").doc(`${teamId}_U1`).set({ teamId, uid: "u1", email: "u1@test.kr" });
    await db.collection("slackTasks").doc(`${teamId}-task`).set({ teamId, text: "예약해줘" });
    await db.collection("slackConfirmations").doc(`${teamId}-confirm`).set({ teamId, status: "pending" });

    await db.collection("auditLogs").doc(`${orgId}-audit`).set({ organizationId: orgId, action: "update" });
}

async function countAll(orgId: string, teamId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const byOrg: Array<[string, string]> = [
        ["driveLogs", "organizationId"], ["reservations", "organizationId"], ["hipassCharges", "organizationId"],
        ["fuelLogs", "organizationId"], ["maintenanceRecords", "organizationId"], ["notifications", "organizationId"],
        ["favorites", "organizationId"], ["feedbacks", "organizationId"], ["slackOauthStates", "organizationId"],
        ["calendarBindings", "organizationId"], ["vehicles", "organizationId"], ["hipassCards", "organizationId"],
        ["users", "organizationId"], ["assistantConversations", "orgId"], ["integrations", "organizationId"],
        ["auditLogs", "organizationId"],
    ];
    for (const [collection, field] of byOrg) {
        out[collection] = (await db.collection(collection).where(field, "==", orgId).get()).size;
    }
    for (const collection of ["slackUsers", "slackTasks", "slackConfirmations"]) {
        out[collection] = (await db.collection(collection).where("teamId", "==", teamId).get()).size;
    }
    const orgRef = db.collection("organizations").doc(orgId);
    out.organizations = (await orgRef.get()).exists ? 1 : 0;
    out.customHolidays = (await orgRef.collection("customHolidays").get()).size;
    out.preRegistered = (await orgRef.collection("preRegistered").get()).size;
    out.orgSubStats = (await orgRef.collection("stats").get()).size;
    out.orgStats = (await db.collection("orgStats").doc(orgId).get()).exists ? 1 : 0;
    out.orgStatsMonthly = (await db.collection("orgStats").doc(orgId).collection("monthly").get()).size;
    out.assistantVehicleCache = (await db.collection("assistantVehicleCache").doc(orgId).get()).exists ? 1 : 0;
    return out;
}

function fakeBucket() {
    const prefixes: string[] = [];
    return {
        prefixes,
        deleteFiles: async ({ prefix }: { prefix: string }) => { prefixes.push(prefix); },
    };
}

describe("purgeOrganizationData (에뮬레이터)", () => {
    beforeEach(async () => {
        await clearFirestoreData();
        await seedOrg(GONE, "deleted", "T-GONE");
        await seedOrg(LIVE, "approved", "T-LIVE");
        // 기관 필드가 빈 문서 — 잘못된 ID로 돌면 이런 문서가 통째로 지워진다
        await db.collection("feedbacks").doc("public-inquiry").set({ organizationId: "", message: "공개 문의" });
    });

    it("해지 기관의 데이터를 전부 지우고, 다른 기관·빈 기관 필드 문서·감사 기록은 남긴다", async () => {
        const liveBefore = await countAll(LIVE, "T-LIVE");
        const bucket = fakeBucket();

        const summary = await purgeOrganizationData(GONE, bucket, db);

        const gone = await countAll(GONE, "T-GONE");
        const { auditLogs, ...goneWithoutAudit } = gone;
        expect(Object.entries(goneWithoutAudit).filter(([, n]) => n !== 0)).toEqual([]);
        expect(auditLogs).toBe(1);

        expect(await countAll(LIVE, "T-LIVE")).toEqual(liveBefore);
        expect((await db.collection("feedbacks").doc("public-inquiry").get()).exists).toBe(true);

        expect(bucket.prefixes).toEqual([`organizations/${GONE}/`]);
        expect(summary.deleted.driveLogs).toBe(2);
        expect(summary.deleted.organizations).toBe(1);
    });

    it("두 번 돌려도 안전하다 — 이미 끝난 기관은 할 일이 없다", async () => {
        await purgeOrganizationData(GONE, fakeBucket(), db);
        const again = await purgeOrganizationData(GONE, fakeBucket(), db);
        expect(again.deleted).toEqual({});
    });

    it("해지 상태가 아닌 기관은 아무것도 지우지 않고 거부한다", async () => {
        const before = await countAll(LIVE, "T-LIVE");
        const bucket = fakeBucket();

        await expect(purgeOrganizationData(LIVE, bucket, db)).rejects.toBeInstanceOf(OrgNotRetiredError);

        expect(await countAll(LIVE, "T-LIVE")).toEqual(before);
        expect(bucket.prefixes).toEqual([]);
    });

    it.each(["", "  ", "__system__", "a/b"])("올바르지 않은 기관 ID(%j)는 거부한다", async (orgId) => {
        await expect(purgeOrganizationData(orgId, fakeBucket(), db)).rejects.toThrow(/올바르지 않다/);
        expect((await db.collection("feedbacks").doc("public-inquiry").get()).exists).toBe(true);
    });
});
