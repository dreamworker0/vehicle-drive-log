/**
 * nightlySharedData 에뮬레이터 통합 테스트
 *
 * 야간 배치가 원본을 한 번만 읽어 두 스텝에 넘기도록 바꿨다(2026-09-25 읽기 절감).
 * 읽기를 줄이는 변경이라 **대시보드 캐시가 예전과 같아야** 한다. 실제 Firestore 에뮬레이터에서
 * 직접 조회 경로와 선로딩 경로의 결과를 비교한다. 선로딩은 월간 집계를 위해 대시보드 창보다
 * 이른 시점부터 읽으므로, 그 사이의 운행일지가 대시보드에 새지 않는지도 함께 본다.
 */
import {
    initializeTestApp,
    clearFirestoreData,
    getTestFirestore,
} from "./emulator.setup";

initializeTestApp();

const db = getTestFirestore();

/** 비교에서 뺄 필드 — 실행할 때마다 달라진다 */
function stable(data: FirebaseFirestore.DocumentData | undefined) {
    const { lastUpdatedAt: _a, computeDurationMs: _b, ...rest } = data ?? {};
    return rest;
}

describe("computeAllDashboardStats — 선로딩 경로 (에뮬레이터)", () => {
    beforeAll(async () => {
        await clearFirestoreData();
        const day = 24 * 60 * 60 * 1000;
        const fortyDaysAgo = new Date(Date.now() - 40 * day);

        await db.collection("organizations").doc("org1").set({
            name: "테스트기관", status: "approved", createdAt: fortyDaysAgo, approvedAt: fortyDaysAgo,
        });
        await db.collection("users").doc("user1").set({ email: "a@test.com", role: "employee", organizationId: "org1" });
        await db.collection("vehicles").doc("veh1").set({ displayName: "스타렉스", organizationId: "org1" });

        // 대시보드 창 안(어제) 1건 + 창 밖이지만 선로딩 창 안(50일 전) 1건
        await db.collection("driveLogs").add({
            organizationId: "org1", driverUid: "user1", vehicleId: "veh1",
            startKm: 100, endKm: 150, startTime: "09:00", endTime: "10:00",
            timestamp: new Date(Date.now() - day),
        });
        await db.collection("driveLogs").add({
            organizationId: "org1", driverUid: "user1", vehicleId: "veh1",
            startKm: 0, endKm: 100, startTime: "09:00", endTime: "11:00",
            timestamp: new Date(Date.now() - 50 * day),
        });
    });

    afterAll(async () => {
        await clearFirestoreData();
    });

    it("직접 조회와 같은 캐시 문서를 만든다 — 선로딩 창의 이른 운행일지는 섞이지 않는다", async () => {
        const { computeAllDashboardStats } = await import("../services/statistics/computeDashboardStats");
        const { loadNightlySharedData } = await import("../services/statistics/nightlySharedData");
        const paths = ["system/dashboardStats", "system/dashboardTimeSeries", "system/dashboardOrgRankings", "system/dashboardStats_org1"];

        await computeAllDashboardStats();
        const direct = await Promise.all(paths.map(async (p) => stable((await db.doc(p).get()).data())));

        const shared = await loadNightlySharedData(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
        expect(shared.driveLogDocs).toHaveLength(2); // 선로딩은 50일 전 기록까지 읽는다
        await computeAllDashboardStats(shared);
        const viaShared = await Promise.all(paths.map(async (p) => stable((await db.doc(p).get()).data())));

        expect(viaShared).toEqual(direct);
        expect((direct[0] as { monthlyStats?: { logs?: number } }).monthlyStats).toBeDefined();
    });
});
