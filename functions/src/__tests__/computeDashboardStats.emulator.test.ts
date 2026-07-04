/**
 * computeDashboardStats 에뮬레이터 통합 테스트
 *
 * 주유/하이패스/알림 통계의 서버 캐시 이관을 실제 Firestore 에뮬레이터로 검증:
 * - admin SDK 집계쿼리(count/sum)가 기대대로 동작하는지
 * - system/dashboardStats·dashboardTimeSeries에 새 필드가 올바른 값으로 쓰이는지
 * - KST 'M/D' 일별 버킷팅이 오늘 날짜에 정확히 매핑되는지
 */
import {
    initializeTestApp,
    clearFirestoreData,
    getTestFirestore,
} from "./emulator.setup";
import { getKSTYear, getKSTMonth, getKSTDay } from "../utils/kstDate";

initializeTestApp();

const db = getTestFirestore();

/** KST 기준 오늘/이전 날짜의 'YYYY-MM-DD' 문자열 */
function kstDateStr(offsetDays = 0): string {
    const base = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    const y = getKSTYear(base), m = getKSTMonth(base), d = getKSTDay(base);
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** KST 기준 오늘의 'M/D' 차트 키 */
function kstChartKey(offsetDays = 0): string {
    const base = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return `${getKSTMonth(base) + 1}/${getKSTDay(base)}`;
}

/** KST 기준 전월 15일의 'YYYY-MM-DD' */
function prevMonthDateStr(): string {
    const y = getKSTYear(), m = getKSTMonth();
    const prevY = m === 0 ? y - 1 : y;
    const prevM = m === 0 ? 11 : m - 1;
    return `${prevY}-${String(prevM + 1).padStart(2, "0")}-15`;
}

describe("computeAllDashboardStats — 주유/하이패스/알림 캐시 이관 (에뮬레이터)", () => {
    beforeAll(async () => {
        await clearFirestoreData();

        const today = kstDateStr(0);
        const yesterday = kstDateStr(-1);
        const now = new Date();
        const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

        // 기관 1 + 사용자 1 (buildStats 루프가 정상 순회하도록 최소 시드)
        await db.collection("organizations").doc("org1").set({
            name: "테스트기관", status: "approved", createdAt: fortyDaysAgo, approvedAt: fortyDaysAgo,
        });
        await db.collection("users").doc("user1").set({
            email: "emp@test.com", role: "employee", organizationId: "org1",
        });

        // 주유: 오늘 2건(50,000+30,000) + 전월 1건(10,000)
        await db.collection("fuelLogs").add({ organizationId: "org1", date: today, fuelCost: 50000 });
        await db.collection("fuelLogs").add({ organizationId: "org1", date: today, fuelCost: 30000 });
        await db.collection("fuelLogs").add({ organizationId: "org1", date: prevMonthDateStr(), fuelCost: 10000 });

        // 하이패스: 어제 1건(5,000)
        await db.collection("hipassCharges").add({ organizationId: "org1", date: yesterday, chargeAmount: 5000 });

        // 알림: 오늘 읽음 1 + 안읽음 1 (30일 윈도우 내) + 40일 전 1건 (윈도우 밖 — 총계에만 포함)
        await db.collection("notifications").add({ organizationId: "org1", type: "notice", read: true, createdAt: now });
        await db.collection("notifications").add({ organizationId: "org1", type: "reservation_confirmed", read: false, createdAt: now });
        await db.collection("notifications").add({ organizationId: "org1", type: "approval", read: false, createdAt: fortyDaysAgo });
    });

    afterAll(async () => {
        await clearFirestoreData();
    });

    it("재집계 후 캐시 문서에 주유/하이패스/알림 필드가 올바른 값으로 저장된다", async () => {
        // 실제 배치 함수 실행 (에뮬레이터 Firestore 대상 — 집계쿼리 포함)
        const { computeAllDashboardStats } = await import("../services/statistics/computeDashboardStats");
        await computeAllDashboardStats();

        const statsSnap = await db.doc("system/dashboardStats").get();
        const tsSnap = await db.doc("system/dashboardTimeSeries").get();
        expect(statsSnap.exists).toBe(true);
        expect(tsSnap.exists).toBe(true);

        const stats = statsSnap.data()!;
        const ts = tsSnap.data()!;

        // ── 주유 요약 (전체 3건 90,000 / 당월 2건 80,000 / 전월 10,000) ──
        expect(stats.fuelStats).toEqual({
            totalCount: 3, totalCost: 90000,
            monthCount: 2, monthCost: 80000,
            prevMonthCost: 10000,
        });

        // ── 하이패스 요약 ──
        expect(stats.hipassStats).toEqual({
            totalCount: 1, totalAmount: 5000,
            monthCount: 1, monthAmount: 5000,
            prevMonthAmount: 0,
        });

        // ── 알림 요약 (총 3, 읽음 1 → 33%) ──
        expect(stats.notifSummary).toEqual({ total: 3, read: 1, unread: 2, readRate: 33 });

        // ── 일별 시계열: 30일 키 + KST 오늘 버킷 ──
        expect(ts.dailyFuelCost).toHaveLength(30);
        expect(ts.dailyFuelCost.find((d: { date: string }) => d.date === kstChartKey(0)))
            .toEqual({ date: kstChartKey(0), cost: 80000 });
        expect(ts.dailyHipassAmount.find((d: { date: string }) => d.date === kstChartKey(-1)))
            .toEqual({ date: kstChartKey(-1), amount: 5000 });
        expect(ts.dailyNotifStats.find((d: { date: string }) => d.date === kstChartKey(0)))
            .toEqual({ date: kstChartKey(0), sent: 2, read: 1 });

        // ── 타입 분포: 30일 윈도우 내 2건만 (40일 전 approval 미포함), 원시 type 키 ──
        expect(ts.notifTypeCounts).toHaveLength(2);
        expect(ts.notifTypeCounts).toEqual(
            expect.arrayContaining([
                { type: "notice", count: 1 },
                { type: "reservation_confirmed", count: 1 },
            ])
        );

        // ── 기관별 변형 문서에는 새 필드가 없어야 함 (ALL 스코프 전용) ──
        const orgStatsSnap = await db.doc("system/dashboardStats_org1").get();
        expect(orgStatsSnap.exists).toBe(true);
        expect(orgStatsSnap.data()!.fuelStats).toBeUndefined();
        expect(orgStatsSnap.data()!.notifSummary).toBeUndefined();
    });
});
