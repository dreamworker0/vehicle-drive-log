/**
 * dailyAggregation.test.ts
 *
 * runDailyAggregation(월별 집계 프로듀서) 단위 테스트 — firebase-admin/firestore를 Mocking해
 * orgStats/{orgId}/monthly/{YYYY-MM} 저장 페이로드를 검증한다.
 * 특히 과거 회귀(admin 분석 대시보드 0/빈값)를 유발했던 필드명 버그를 고정한다:
 *   - 운전자 식별자는 driverUid (uid/driverId 아님)
 *   - 주유비 필드는 fuelCost (amount/cost 아님)
 * 및 확장 필드(차량별 연비·정비비, 이상탐지) 산출을 검증한다.
 */
import { toKSTDate } from "../utils/kstDate";

// 저장 페이로드 캡처
const mockSet = jest.fn();

// KST 기준 특정 요일/시각의 UTC instant를 만드는 헬퍼 (KST 벽시계 - 9h = UTC)
function kstInstant(y: number, m0: number, d: number, h: number): Date {
    return new Date(Date.UTC(y, m0, d, h - 9, 0, 0, 0));
}

// 테스트 운행일지 (June 2026)
const tsSunday10 = kstInstant(2026, 5, 7, 10);   // 일요일 추정 시각 10시
const tsWeekday23 = kstInstant(2026, 5, 8, 23);  // 다음날 23시(심야)
const driveLogs = [
    // veh-1 / u1: 일자 A, 거리 250 (>200 → overDrive 버킷)
    { driverUid: "u1", driverName: "김운전", vehicleId: "veh-1", vehicleName: "스타렉스", startKm: 0, endKm: 250, timestamp: { toDate: () => tsSunday10 } },
    // veh-1 / u1: 일자 B, 거리 50, 심야
    { driverUid: "u1", driverName: "김운전", vehicleId: "veh-1", startKm: 250, endKm: 300, timestamp: { toDate: () => tsWeekday23 } },
    // veh-2 / u2: 거리 80
    { driverUid: "u2", driverName: "이기사", vehicleId: "veh-2", startKm: 0, endKm: 80, timestamp: { toDate: () => tsWeekday23 } },
];
const fuelLogs = [
    { vehicleId: "veh-1", fuelCost: 90000, date: "2026-06-10" },
    { vehicleId: "veh-2", fuelCost: 40000, date: "2026-06-11" },
];
const hipassCharges = [
    { vehicleId: "veh-1", chargeAmount: 8000, date: "2026-06-10" },
];
const maintenanceRecords = [
    { vehicleId: "veh-1", cost: 120000, date: "2026-06-05" },
    { vehicleId: "veh-1", cost: 30000, date: "2026-06-20" },
];

function snap(docs: Array<Record<string, unknown>>) {
    return {
        docs: docs.map((d, i) => ({ id: (d.id as string) || `doc-${i}`, data: () => d })),
        forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) =>
            docs.forEach((d, i) => cb({ id: (d.id as string) || `doc-${i}`, data: () => d })),
        size: docs.length,
    };
}

/** 기본 픽스처 — 테스트별로 갈아 끼운다(집계 건너뛰기 분기 검증용). beforeEach가 되돌린다. */
const DEFAULT_ORGS = [{ id: "org-1", name: "테스트기관" }];
const DEFAULT_USERS = [{ id: "u1", name: "김운전" }, { id: "u2", name: "이기사" }];
const DEFAULT_VEHICLES = [{ id: "veh-1", name: "스타렉스" }, { id: "veh-2", name: "카니발" }];

const fixtures: {
    orgs: Array<Record<string, unknown>>;
    users: Array<Record<string, unknown>>;
    vehicles: Array<Record<string, unknown>>;
    /** 어떤 컬렉션에 실제로 접근했는지 — "쿼리를 아예 걸지 않는다"를 검증한다. */
    touched: string[];
} = { orgs: [...DEFAULT_ORGS], users: [...DEFAULT_USERS], vehicles: [...DEFAULT_VEHICLES], touched: [] };

jest.mock("firebase-admin/firestore", () => {
    const makeQuery = (docs: Array<Record<string, unknown>>) => {
        const q: Record<string, unknown> = {};
        q.where = jest.fn(() => q);
        q.orderBy = jest.fn(() => q);
        q.get = jest.fn().mockResolvedValue(snap(docs));
        return q;
    };
    return {
        FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TS") },
        getFirestore: jest.fn(() => ({
            collection: jest.fn((name: string) => {
                fixtures.touched.push(name);
                if (name === "organizations") {
                    return { get: jest.fn().mockResolvedValue(snap(fixtures.orgs)) };
                }
                if (name === "users") {
                    return makeQuery(fixtures.users);
                }
                if (name === "vehicles") {
                    return makeQuery(fixtures.vehicles);
                }
                if (name === "driveLogs") return makeQuery(driveLogs);
                if (name === "fuelLogs") return makeQuery(fuelLogs);
                if (name === "hipassCharges") return makeQuery(hipassCharges);
                if (name === "maintenanceRecords") return makeQuery(maintenanceRecords);
                // orgStats/{orgId}/monthly/{ym}
                if (name === "orgStats") {
                    return {
                        doc: jest.fn(() => ({
                            collection: jest.fn(() => ({
                                doc: jest.fn(() => ({ set: mockSet })),
                            })),
                        })),
                    };
                }
                return makeQuery([]);
            }),
        })),
    };
});

import { runDailyAggregation, resolveRecentMonths } from "../handlers/scheduled/dailyAggregation";

describe("runDailyAggregation — 월별 집계 프로듀서", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fixtures.orgs = [...DEFAULT_ORGS];
        fixtures.users = [...DEFAULT_USERS];
        fixtures.vehicles = [...DEFAULT_VEHICLES];
        fixtures.touched = [];
    });

    it("최근 1개월 집계 시 org당 1회 set을 호출하고 요약을 반환한다", async () => {
        const res = await runDailyAggregation(1);
        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ orgs: 1, processed: 1, errors: 0 });
        expect(res.months).toHaveLength(1);
    });

    it("driverStats를 driverUid로 키잉하고 이름·건수·거리를 집계한다 (uid/driverId 버그 회귀 방지)", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        expect(payload.driverStats.u1).toEqual({ name: "김운전", count: 2, distance: 300 });
        expect(payload.driverStats.u2).toEqual({ name: "이기사", count: 1, distance: 80 });
    });

    it("costStats.fuelCost를 FuelLog.fuelCost 필드로 합산한다 (amount/cost 버그 회귀 방지)", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        expect(payload.costStats.fuelCost).toBe(130000); // 90000 + 40000
        expect(payload.costStats.hipassCost).toBe(8000);
        expect(payload.costStats.maintenanceCost).toBe(150000); // 120000 + 30000
    });

    it("차량별 연비/정비비를 vehId 키로 집계한다", async () => {
        await runDailyAggregation(1);
        const v1 = mockSet.mock.calls[0][0].vehicleStats["veh-1"];
        expect(v1.distance).toBe(300);          // 250 + 50
        expect(v1.fuelCost).toBe(90000);
        expect(v1.maintenanceCost).toBe(150000);
        expect(v1.maintenanceCount).toBe(2);
        expect(v1.lastMaintenanceDate).toBe("2026-06-20"); // 최신 정비일
        expect(v1.usedDays).toBe(2);            // 서로 다른 2일
    });

    it("이상탐지(주말/심야/1일 과다주행)를 카운트한다", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        // 주말/심야는 KST 변환 기준으로 정본 유틸과 동일하게 판정되는지 대조
        const expectWeekend = [tsSunday10, tsWeekday23, tsWeekday23]
            .filter((ts) => { const k = toKSTDate(ts).getDay(); return k === 0 || k === 6; }).length;
        const expectNight = [tsSunday10, tsWeekday23, tsWeekday23]
            .filter((ts) => { const h = toKSTDate(ts).getHours(); return h >= 22 || h < 6; }).length;
        expect(payload.anomalies.weekend).toBe(expectWeekend);
        expect(payload.anomalies.night).toBe(expectNight);
        // (u1, 일자A) 버킷 거리 250 > 200 → overDrive 1건
        expect(payload.anomalies.overDrive).toBe(1);
    });

    it("heatmap을 요일→시간 중첩객체로 저장한다", async () => {
        await runDailyAggregation(1);
        const heatmap = mockSet.mock.calls[0][0].heatmap;
        // 각 로그의 KST 요일/시각 버킷이 존재하는지 정본 유틸로 대조
        for (const ts of [tsSunday10, tsWeekday23]) {
            const day = String(toKSTDate(ts).getDay());
            const hour = String(toKSTDate(ts).getHours());
            expect(heatmap[day]?.[hour]).toBeGreaterThanOrEqual(1);
        }
    });

    /**
     * 집계 건너뛰기 — **빈 결과도 1 read로 과금된다**는 것이 이 분기들의 존재 이유다.
     * 기관당 월별 쿼리 4종 × 월 수가 나가므로, 통계를 볼 일이 없는 기관을 걸러내는 것만으로
     * 하룻밤 read가 줄어든다. 되돌리면 조용히 비용만 늘고 결과는 같으므로 테스트로 고정한다.
     */
    describe("집계 대상 기관 선별", () => {
        it("반려·삭제된 기관은 users·vehicles 쿼리조차 걸지 않는다", async () => {
            fixtures.orgs = [{ id: "org-x", name: "반려기관", status: "rejected" }];

            const res = await runDailyAggregation(1);

            expect(res).toMatchObject({ orgs: 1, processed: 0, skipped: 1, errors: 0 });
            expect(mockSet).not.toHaveBeenCalled();
            expect(fixtures.touched).not.toContain("users");
            expect(fixtures.touched).not.toContain("vehicles");
            expect(fixtures.touched).not.toContain("driveLogs");
        });

        it("status가 없는 옛 기관은 그대로 집계한다", async () => {
            // Firestore의 not-in 쿼리를 쓰지 않고 메모리에서 가르는 이유가 이 경우다 —
            // not-in은 필드가 없는 문서를 제외해 옛 기관이 조용히 빠진다.
            fixtures.orgs = [{ id: "org-legacy", name: "옛기관" }];

            const res = await runDailyAggregation(1);

            expect(res).toMatchObject({ processed: 1, skipped: 0 });
            expect(mockSet).toHaveBeenCalledTimes(1);
        });

        it("차량도 구성원도 없는 기관은 월별 쿼리를 걸지 않는다", async () => {
            fixtures.users = [];
            fixtures.vehicles = [];

            const res = await runDailyAggregation(1);

            expect(res).toMatchObject({ orgs: 1, processed: 0, skipped: 1, errors: 0 });
            expect(mockSet).not.toHaveBeenCalled();
            // 판정에 필요한 두 쿼리는 걸지만, 그 뒤 월별 쿼리 4종은 걸지 않는다.
            expect(fixtures.touched).toContain("users");
            expect(fixtures.touched).toContain("vehicles");
            expect(fixtures.touched).not.toContain("driveLogs");
            expect(fixtures.touched).not.toContain("fuelLogs");
        });

        it("차량이 없어도 구성원이 있으면 집계한다", async () => {
            // 차량을 아직 등록하지 않은 신규 기관도 통계 화면을 열 수 있어야 한다.
            fixtures.vehicles = [];

            const res = await runDailyAggregation(1);

            expect(res).toMatchObject({ processed: 1, skipped: 0 });
            expect(fixtures.touched).toContain("driveLogs");
        });
    });
});

/**
 * 지난달 재집계 창 — 전월분 재스캔이 하룻밤 약 4,000 read였다(2026-09-09 실측).
 * 기준 시각이 **실행 시각 -3h**라는 것이 경계 판정의 핵심이므로 날짜별로 고정한다.
 */
describe("resolveRecentMonths — 지난달 재집계 창", () => {
    /** KST 벽시계로 지정한 시각의 UTC instant (배치는 02:00에 돈다) */
    const at = (y: number, m0: number, d: number, h = 2) => kstInstant(y, m0, d, h);

    it("매월 1일 02:00에는 1개월 — 기준일이 전월 말일이라 막 끝난 달만 집계한다", () => {
        expect(resolveRecentMonths(at(2026, 8, 1))).toBe(1);
    });

    it("2일부터 유예일까지는 2개월 — 막 끝난 달의 지각 입력을 흡수한다", () => {
        expect(resolveRecentMonths(at(2026, 8, 2))).toBe(2);
        expect(resolveRecentMonths(at(2026, 8, 11))).toBe(2); // 기준일 10일
    });

    it("유예일이 지나면 1개월 — 같은 답을 매일 다시 계산하지 않는다", () => {
        expect(resolveRecentMonths(at(2026, 8, 12))).toBe(1); // 기준일 11일
        expect(resolveRecentMonths(at(2026, 8, 28))).toBe(1);
    });

    it("월말에도 1개월을 유지한다", () => {
        expect(resolveRecentMonths(at(2026, 7, 31))).toBe(1);
    });
});
