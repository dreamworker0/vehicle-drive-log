/**
 * staleMonths — 소급 입력한 지난달 재집계 표시
 */
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ set: mockSet }));

jest.mock("firebase-admin/firestore", () => ({
    FieldValue: { arrayUnion: jest.fn((...v: string[]) => ({ union: v })) },
    getFirestore: jest.fn(() => ({ collection: jest.fn(() => ({ doc: mockDoc })) })),
}));

import { pickStaleMonths, shiftMonthKey, markStaleMonths } from "../services/statistics/staleMonths";

// 2026-10-01 10:00 KST
const NOW = new Date(Date.UTC(2026, 9, 1, 1, 0, 0));

describe("shiftMonthKey", () => {
    it("해를 넘겨 앞뒤로 옮긴다", () => {
        expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
        expect(shiftMonthKey("2026-10", -12)).toBe("2025-10");
        expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    });
});

describe("pickStaleMonths — 표시할 달 고르기", () => {
    it("이번 달은 매일 밤 집계하므로 빼고, 지난달 이전만 남긴다", () => {
        expect(pickStaleMonths(["2026-10", "2026-09", "2026-03"], NOW)).toEqual(["2026-03", "2026-09"]);
    });

    it("1년보다 오래된 달(보존 기한 정리 등)은 표시하지 않는다", () => {
        expect(pickStaleMonths(["2025-10", "2025-09", "2023-04"], NOW)).toEqual(["2025-10"]);
    });

    it("비어 있거나 깨진 값은 버리고 중복은 하나로", () => {
        expect(pickStaleMonths([null, undefined, "", "2026-7", "2026-07", "2026-07"], NOW)).toEqual(["2026-07"]);
    });
});

describe("markStaleMonths", () => {
    beforeEach(() => jest.clearAllMocks());

    it("지난달 이전 기록이면 orgStats/{orgId}에 합쳐 쓴다", async () => {
        await markStaleMonths("org-1", ["2026-08", "2026-10"], NOW);
        expect(mockDoc).toHaveBeenCalledWith("org-1");
        expect(mockSet).toHaveBeenCalledWith({ staleMonths: { union: ["2026-08"] } }, { merge: true });
    });

    it("이번 달 기록뿐이면 쓰지 않는다 — 대부분의 기록이다", async () => {
        await markStaleMonths("org-1", ["2026-10", null], NOW);
        expect(mockSet).not.toHaveBeenCalled();
    });

    it("쓰기가 실패해도 던지지 않는다 — 트리거를 멈추지 않게", async () => {
        mockSet.mockRejectedValueOnce(new Error("boom"));
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(markStaleMonths("org-1", ["2026-08"], NOW)).resolves.toBeUndefined();
        spy.mockRestore();
    });
});
