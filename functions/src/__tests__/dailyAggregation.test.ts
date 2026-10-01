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
    { driverUid: "u1", driverName: "김운전", vehicleId: "veh-1", vehicleName: "스타렉스", startKm: 0, endKm: 250, timestamp: { toDate: () => tsSunday10 }, reservationId: "r-q", driveOrigin: "quick" },
    // veh-1 / u1: 일자 B, 거리 50, 심야
    { driverUid: "u1", driverName: "김운전", vehicleId: "veh-1", startKm: 250, endKm: 300, timestamp: { toDate: () => tsWeekday23 }, reservationId: "r-old" },
    // veh-2 / u2: 거리 80
    { driverUid: "u2", driverName: "이기사", vehicleId: "veh-2", startKm: 0, endKm: 80, timestamp: { toDate: () => tsWeekday23 } },
];
const fuelLogs = [
    { organizationId: "org-1", vehicleId: "veh-1", fuelCost: 90000, date: "2026-06-10" },
    { organizationId: "org-1", vehicleId: "veh-2", fuelCost: 40000, date: "2026-06-11" },
];
const hipassCharges = [
    { organizationId: "org-1", vehicleId: "veh-1", chargeAmount: 8000, date: "2026-06-10" },
];
const maintenanceRecords = [
    { organizationId: "org-1", vehicleId: "veh-1", cost: 120000, date: "2026-06-05" },
    { organizationId: "org-1", vehicleId: "veh-1", cost: 30000, date: "2026-06-20" },
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

import { runDailyAggregation, resolveRecentMonths, classifyDriveOrigin } from "../handlers/scheduled/dailyAggregation";

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

    it("운행 방식별 건수를 센다 — 옛 일지는 예약 연결 여부로 추정한다", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        // 바로 운행 1(driveOrigin) · 예약 연결만 있는 옛 일지 1(linked) · 예약 없는 일지 1(manual)
        expect(payload.originCounts).toEqual({ reservation: 0, quick: 1, manual: 1, linked: 1 });
    });

    it("직원별·차량별 운행 방식을 함께 센다", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        expect(payload.driverStats.u1.origin).toEqual({ reservation: 0, quick: 1, manual: 0, linked: 1 });
        expect(payload.driverStats.u2.origin).toEqual({ reservation: 0, quick: 0, manual: 1, linked: 0 });
        expect(payload.vehicleStats["veh-1"].origin).toEqual({ reservation: 0, quick: 1, manual: 0, linked: 1 });
        expect(payload.vehicleStats["veh-2"].origin).toEqual({ reservation: 0, quick: 0, manual: 1, linked: 0 });
    });

    it("driverStats를 driverUid로 키잉하고 이름·건수·거리를 집계한다 (uid/driverId 버그 회귀 방지)", async () => {
        await runDailyAggregation(1);
        const payload = mockSet.mock.calls[0][0];
        expect(payload.driverStats.u1).toMatchObject({ name: "김운전", count: 2, distance: 300 });
        expect(payload.driverStats.u2).toMatchObject({ name: "이기사", count: 1, distance: 80 });
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

    describe("출발 시각 · 다일 운행 · 운전자 미지정 · 통째 저장", () => {
        // 픽스처가 2026년 6월이다 — 집계 창(이번 달)을 6월로 맞춰야 다일 운행의 '이 달 날짜' 판정이 맞다
        beforeEach(() => {
            jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
            jest.setSystemTime(new Date("2026-06-20T03:00:00Z"));
        });
        afterEach(() => jest.useRealTimers());

        /** 기본 픽스처에 기록을 잠시 더한다(driveLogs는 모듈 스코프 배열이라 끝나면 되돌린다) */
        async function runWith(extra: Array<Record<string, unknown>>) {
            const before = driveLogs.length;
            driveLogs.push(...extra);
            try {
                await runDailyAggregation(1);
                return mockSet.mock.calls[0][0];
            } finally {
                driveLogs.length = before;
            }
        }

        it("심야·요일은 도착이 아니라 출발 시각으로 본다 — 21:00 출발·22:30 도착은 심야가 아니다", async () => {
            const base = await runWith([]);
            const payload = await (async () => { jest.clearAllMocks(); return runWith([
                // 수요일 21:00 출발 → 22:30 도착 (예전엔 도착 시각이라 심야로 셌다)
                { driverUid: "u2", vehicleId: "veh-2", startKm: 0, endKm: 10, startTime: "21:00",
                  timestamp: { toDate: () => kstInstant(2026, 5, 10, 22) } },
                // 05:00 출발 → 07:00 도착 (예전엔 빠졌다)
                { driverUid: "u2", vehicleId: "veh-2", startKm: 10, endKm: 20, startTime: "05:00",
                  timestamp: { toDate: () => kstInstant(2026, 5, 10, 7) } },
            ]); })();
            expect(payload.anomalies.night - base.anomalies.night).toBe(1);
            expect(payload.heatmap["3"]?.["21"]).toBe(1); // 2026-06-10은 수요일, 출발 21시 칸
            expect(payload.heatmap["3"]?.["5"]).toBe(1);
        });

        it("다일 운행은 출발일로 요일을 보고, 과다주행에서 빼고, 가동일은 출발~도착을 모두 센다", async () => {
            const payload = await runWith([
                // 6/12(금) 출발 → 6/14(일) 도착, 400km
                { driverUid: "u2", vehicleId: "veh-2", startKm: 100, endKm: 500, startDate: "2026-06-12", startTime: "09:00",
                  timestamp: { toDate: () => kstInstant(2026, 5, 14, 18) } },
            ]);
            // 기본 픽스처의 과다주행 1건(250km 하루)만 남는다 — 이틀 400km는 하루 과다주행이 아니다
            expect(payload.anomalies.overDrive).toBe(1);
            // veh-2: 기본 1일(6/8) + 6/12·13·14 = 4일
            expect(payload.vehicleStats["veh-2"].usedDays).toBe(4);
            expect(payload.heatmap["5"]?.["9"]).toBe(1); // 금요일 9시(출발) 칸
        });

        it("driverUid가 없는 옛 기록도 '(운전자 미지정)'으로 센다 — 직원별 합이 총계와 맞는다", async () => {
            const payload = await runWith([
                { driverName: "옛기록", vehicleId: "veh-2", startKm: 0, endKm: 30, timestamp: { toDate: () => tsWeekday23 } },
            ]);
            expect(payload.driverStats.__unassigned).toMatchObject({ name: "(운전자 미지정)", count: 1, distance: 30 });
            const sum = Object.values(payload.driverStats as Record<string, { count: number }>).reduce((a, d) => a + d.count, 0);
            expect(sum).toBe(payload.monthlyTotal.count);
        });

        it("merge 없이 통째로 저장한다 — 지워진 직원·차량·히트맵 칸이 남지 않게", async () => {
            await runDailyAggregation(1);
            expect(mockSet.mock.calls[0]).toHaveLength(1); // 두 번째 인자({ merge: true })가 없다
        });
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

/**
 * 선로딩 경로 — 야간 배치가 대시보드 단계와 함께 읽은 원본(nightlySharedData)으로 집계한다.
 *
 * 읽기를 줄이는 변경이라 **결과가 같아야** 한다. 기관별 쿼리 경로와 같은 페이로드를 내는지,
 * 다른 기관·집계 창 밖의 운행일지를 섞지 않는지, 기관별 쿼리를 더는 걸지 않는지를 고정한다.
 */
describe("runDailyAggregation — 선로딩 데이터 경로", () => {
    const qdoc = (d: Record<string, unknown>, i: number) => ({ id: (d.id as string) || `s-${i}`, data: () => d });
    const shared = () => ({
        orgDocs: DEFAULT_ORGS.map(qdoc),
        userDocs: [
            ...DEFAULT_USERS.map((u) => ({ ...u, organizationId: "org-1" })),
            { id: "u-other", name: "남의직원", organizationId: "org-2" },
        ].map(qdoc),
        vehicleDocs: [
            ...DEFAULT_VEHICLES.map((v) => ({ ...v, organizationId: "org-1" })),
            { id: "veh-other", name: "남의차", organizationId: "org-2" },
        ].map(qdoc),
        driveLogDocs: [
            ...driveLogs.map((d) => ({ ...d, organizationId: "org-1" })),
            // 다른 기관 — 섞이면 안 된다
            { ...driveLogs[0], organizationId: "org-2" },
            // 집계 창(6월) 밖 — 7월 1일 KST
            { ...driveLogs[0], organizationId: "org-1", timestamp: { toDate: () => kstInstant(2026, 6, 1, 9) } },
            // timestamp가 Timestamp가 아닌 옛 기록 — 기관별 범위 쿼리에도 걸리지 않던 문서다
            { ...driveLogs[0], organizationId: "org-1", timestamp: "2026-06-10" },
        ].map(qdoc) as never[],
        driveLogScanStart: kstInstant(2026, 5, 1, 0),
    });

    beforeEach(() => {
        jest.clearAllMocks();
        fixtures.orgs = [...DEFAULT_ORGS];
        fixtures.users = [...DEFAULT_USERS];
        fixtures.vehicles = [...DEFAULT_VEHICLES];
        fixtures.touched = [];
        // 집계 창이 6월이 되도록 실행 시각을 6월 25일 02:00(KST)로 고정한다
        jest.useFakeTimers().setSystemTime(kstInstant(2026, 5, 25, 2));
    });
    afterEach(() => jest.useRealTimers());

    it("기관별 쿼리 경로와 같은 페이로드를 저장한다", async () => {
        await runDailyAggregation(1);
        const viaQueries = mockSet.mock.calls[0][0];
        mockSet.mockClear();

        await runDailyAggregation(1, shared() as never);
        const viaShared = mockSet.mock.calls[0][0];

        expect(viaShared).toEqual(viaQueries);
    });

    it("기관 목록·구성원·차량·운행일지를 다시 읽지 않고, 비용 기록만 월 단위로 읽는다", async () => {
        const res = await runDailyAggregation(1, shared() as never);

        expect(res).toMatchObject({ orgs: 1, processed: 1, errors: 0 });
        expect(fixtures.touched).not.toContain("organizations");
        expect(fixtures.touched).not.toContain("users");
        expect(fixtures.touched).not.toContain("vehicles");
        expect(fixtures.touched).not.toContain("driveLogs");
        expect(fixtures.touched.filter((n) => n === "fuelLogs")).toHaveLength(1);
    });

    it("선로딩 창이 집계 창보다 늦게 시작하면 운행일지는 기관별 쿼리로 읽는다", async () => {
        const late = { ...shared(), driveLogScanStart: kstInstant(2026, 5, 10, 0) };

        await runDailyAggregation(1, late as never);

        expect(fixtures.touched).toContain("driveLogs");
    });
});

describe("classifyDriveOrigin", () => {
    it("저장된 driveOrigin을 그대로 쓴다", () => {
        expect(classifyDriveOrigin({ driveOrigin: "reservation", reservationId: "r" })).toBe("reservation");
        expect(classifyDriveOrigin({ driveOrigin: "quick", reservationId: "r" })).toBe("quick");
        expect(classifyDriveOrigin({ driveOrigin: "manual" })).toBe("manual");
    });
    it("driveOrigin이 없으면 예약 연결 여부로 — 연결이 있으면 구분 전(linked)", () => {
        expect(classifyDriveOrigin({ reservationId: "r" })).toBe("linked");
        expect(classifyDriveOrigin({ reservationId: null })).toBe("manual");
        expect(classifyDriveOrigin({})).toBe("manual");
    });
    it("알 수 없는 값은 믿지 않는다", () => {
        expect(classifyDriveOrigin({ driveOrigin: "hacked", reservationId: "r" })).toBe("linked");
    });
});
