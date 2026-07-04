/**
 * computeFuelHipassDaily.test.ts
 * - 주유/하이패스 일별 집계 순수 함수 단위 테스트 (ALL 스코프 캐시 이관)
 * - Firestore 호출이 없으므로 .data()만 가진 가짜 doc으로 검증
 */
import { computeFuelHipassDaily } from "../services/statistics/dashboardSections";

function fakeDoc(data: Record<string, unknown>): FirebaseFirestore.QueryDocumentSnapshot {
    return { data: () => data } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
}

describe("computeFuelHipassDaily", () => {
    // 고정 윈도우 시작일 (KST 'YYYY-MM-DD') — 30일 키: 6/1 ~ 6/30
    const thirtyDaysAgoStr = "2026-06-01";

    it("빈 입력이면 30일 키를 0으로 채운다", () => {
        const r = computeFuelHipassDaily([], [], thirtyDaysAgoStr, null);

        expect(r.dailyFuelCost).toHaveLength(30);
        expect(r.dailyHipassAmount).toHaveLength(30);
        expect(r.dailyFuelCost[0]).toEqual({ date: "6/1", cost: 0 });
        expect(r.dailyFuelCost[29]).toEqual({ date: "6/30", cost: 0 });
        expect(r.dailyFuelCost.every(d => d.cost === 0)).toBe(true);
        expect(r.dailyHipassAmount.every(d => d.amount === 0)).toBe(true);
    });

    it("같은 날짜의 비용을 합산하고 키('M/D')에 매핑한다", () => {
        const fuel = [
            fakeDoc({ date: "2026-06-05", fuelCost: 50000 }),
            fakeDoc({ date: "2026-06-05", fuelCost: 30000 }),
            fakeDoc({ date: "2026-06-10", fuelCost: 20000 }),
        ];
        const hipass = [
            fakeDoc({ date: "2026-06-05", chargeAmount: 10000 }),
        ];

        const r = computeFuelHipassDaily(fuel, hipass, thirtyDaysAgoStr, null);

        expect(r.dailyFuelCost.find(d => d.date === "6/5")).toEqual({ date: "6/5", cost: 80000 });
        expect(r.dailyFuelCost.find(d => d.date === "6/10")).toEqual({ date: "6/10", cost: 20000 });
        expect(r.dailyHipassAmount.find(d => d.date === "6/5")).toEqual({ date: "6/5", amount: 10000 });
    });

    it("윈도우 첫날(시작일)은 포함, 이전 날짜는 제외한다", () => {
        const fuel = [
            fakeDoc({ date: "2026-06-01", fuelCost: 1000 }), // 경계일 — 포함
            fakeDoc({ date: "2026-05-31", fuelCost: 9999 }), // 윈도우 밖 — 제외
        ];
        const r = computeFuelHipassDaily(fuel, [], thirtyDaysAgoStr, null);

        expect(r.dailyFuelCost.find(d => d.date === "6/1")).toEqual({ date: "6/1", cost: 1000 });
        expect(r.dailyFuelCost.reduce((s, d) => s + d.cost, 0)).toBe(1000);
    });

    it("금액 필드가 없거나 date가 비정상이면 안전하게 무시/0 처리한다", () => {
        const fuel = [
            fakeDoc({ date: "2026-06-03" }),                 // fuelCost 없음 → 0 합산
            fakeDoc({ fuelCost: 5000 }),                     // date 없음 → 제외
            fakeDoc({ date: "invalid", fuelCost: 5000 }),    // 파싱 불가 → 제외
        ];
        const r = computeFuelHipassDaily(fuel, [], thirtyDaysAgoStr, null);

        expect(r.dailyFuelCost.find(d => d.date === "6/3")).toEqual({ date: "6/3", cost: 0 });
        expect(r.dailyFuelCost.reduce((s, d) => s + d.cost, 0)).toBe(0);
    });

    it("orgFilterId가 주어지면 다른 기관 문서는 제외한다", () => {
        const fuel = [
            fakeDoc({ date: "2026-06-07", fuelCost: 1000, organizationId: "orgA" }),
            fakeDoc({ date: "2026-06-07", fuelCost: 2000, organizationId: "orgB" }),
        ];
        const r = computeFuelHipassDaily(fuel, [], thirtyDaysAgoStr, "orgA");

        expect(r.dailyFuelCost.find(d => d.date === "6/7")).toEqual({ date: "6/7", cost: 1000 });
    });
});
