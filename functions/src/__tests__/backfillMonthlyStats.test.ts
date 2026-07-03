/**
 * backfillMonthlyStats.test.ts
 *
 * 월별 집계 소급 재집계 콜러블의 권한 가드와 months 파라미터 클램프를 검증한다.
 * runDailyAggregation은 mock 처리해 호출 인자만 확인한다(집계 로직 자체는 dailyAggregation.test.ts에서 검증).
 */
const mockRun = jest.fn().mockResolvedValue({ orgs: 3, processed: 3, errors: 0, months: ["2026-07"] });
jest.mock("../handlers/scheduled/dailyAggregation", () => ({
    runDailyAggregation: (...args: unknown[]) => mockRun(...args),
}));

import { backfillMonthlyStats } from "../handlers/callable/backfillMonthlyStats";

// onCall 래핑을 벗겨 핸들러를 직접 호출 (v2 onCall은 .run으로 핸들러 실행)
type Callable = { run: (req: unknown) => Promise<unknown> };
const invoke = (data: unknown, auth: unknown) =>
    (backfillMonthlyStats as unknown as Callable).run({ data, auth });

const superAdmin = { uid: "admin-1", token: { role: "superAdmin" } };

describe("backfillMonthlyStats — 월별 집계 백필 콜러블", () => {
    beforeEach(() => jest.clearAllMocks());

    it("비인증 호출을 거부한다", async () => {
        await expect(invoke({ months: 6 }, null)).rejects.toThrow(/로그인/);
        expect(mockRun).not.toHaveBeenCalled();
    });

    it("superAdmin이 아니면 거부한다", async () => {
        await expect(invoke({ months: 6 }, { uid: "u1", token: { role: "admin" } }))
            .rejects.toThrow(/시스템 관리자/);
        expect(mockRun).not.toHaveBeenCalled();
    });

    it("months 미지정 시 기본 6개월로 재집계하고 요약을 반환한다", async () => {
        const res = await invoke({}, superAdmin) as { success: boolean; months: number; processed: number; errors: number };
        expect(mockRun).toHaveBeenCalledWith(6);
        expect(res.success).toBe(true);
        expect(res.months).toBe(6);
        expect(res.processed).toBe(3);
        expect(res.errors).toBe(0);
    });

    it("일부 기관 집계 실패 시 success=false로 보고한다", async () => {
        mockRun.mockResolvedValueOnce({ orgs: 3, processed: 2, errors: 1, months: ["2026-07"] });
        const res = await invoke({ months: 6 }, superAdmin) as { success: boolean; errors: number };
        expect(res.success).toBe(false);
        expect(res.errors).toBe(1);
    });

    it("months를 1~24 범위로 클램프한다", async () => {
        await invoke({ months: 100 }, superAdmin);
        expect(mockRun).toHaveBeenCalledWith(24);

        mockRun.mockClear();
        await invoke({ months: 0 }, superAdmin);
        expect(mockRun).toHaveBeenCalledWith(1);

        mockRun.mockClear();
        await invoke({ months: 3 }, superAdmin);
        expect(mockRun).toHaveBeenCalledWith(3);
    });
});
