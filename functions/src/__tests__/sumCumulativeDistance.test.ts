import { sumCumulativeDistance } from "../services/statistics/dashboardHelpers";

describe("sumCumulativeDistance — 대시보드 '총 주행거리' 누적 합", () => {
    const byOrg = { orgA: 1200.4, orgB: 300.3, orgC: 0 };

    it("기관 필터가 없으면 전 기관 누적을 더해 반올림한다", () => {
        expect(sumCumulativeDistance(byOrg, null)).toBe(1501);
    });

    it("기관 필터가 있으면 그 기관 누적만 돌려준다", () => {
        expect(sumCumulativeDistance(byOrg, "orgB")).toBe(300);
    });

    it("집계 문서가 없는 기관은 0이다", () => {
        expect(sumCumulativeDistance(byOrg, "orgZ")).toBe(0);
        expect(sumCumulativeDistance({}, null)).toBe(0);
    });

    it("증분이 어긋나 음수가 된 기관은 합에서 빼지 않고 0으로 본다", () => {
        expect(sumCumulativeDistance({ orgA: 500, orgB: -80 }, null)).toBe(500);
        expect(sumCumulativeDistance({ orgB: -80 }, "orgB")).toBe(0);
    });
});
