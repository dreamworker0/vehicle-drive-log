/**
 * dailyAggregation.test.ts
 *
 * Firebase Emulator(@firebase/rules-unit-testing 등) 대신
 * npm run test 시 에뮬레이터 없이도 통과하도록 firestore-admin을 Mocking하여
 * 더미 기관, 운행일지, 주유 기록 등을 삽입한 것과 동일하게 동작하도록 검증합니다.
 */

const mockForEachDrive = jest.fn((callback) => {
    callback({ data: () => ({ organizationId: "org-123", driverUid: "user-1", vehicleId: "veh-1", date: "2026-06-10" }) });
    callback({ data: () => ({ organizationId: "org-123", driverUid: "user-2", vehicleId: "veh-1", date: "2026-06-11" }) });
});

const mockForEachFuel = jest.fn((callback) => {
    callback({ data: () => ({ organizationId: "org-123", driverUid: "user-1", vehicleId: "veh-1", amount: 50000, toll: 1200 }) });
    callback({ data: () => ({ organizationId: "org-123", driverUid: "user-2", vehicleId: "veh-1", amount: 30000, toll: 0 }) });
});

const mockSet = jest.fn();

jest.mock("firebase-admin/firestore", () => {
    return {
        getFirestore: jest.fn(() => ({
            collection: jest.fn((colPath) => {
                if (colPath === "organizations") {
                    return {
                        get: jest.fn().mockResolvedValue({
                            docs: [{ id: "org-123", data: () => ({ name: "테스트 기관" }) }]
                        })
                    };
                }
                if (colPath === "driveLogs") {
                    return {
                        where: jest.fn().mockReturnThis(),
                        get: jest.fn().mockResolvedValue({
                            size: 2,
                            forEach: mockForEachDrive
                        })
                    };
                }
                if (colPath === "fuelLogs") {
                    return {
                        where: jest.fn().mockReturnThis(),
                        get: jest.fn().mockResolvedValue({
                            size: 2,
                            forEach: mockForEachFuel
                        })
                    };
                }
                return {
                    where: jest.fn().mockReturnThis(),
                    get: jest.fn().mockResolvedValue({ docs: [], size: 0, forEach: jest.fn() })
                };
            }),
            doc: jest.fn(() => ({
                set: mockSet
            }))
        }))
    };
});

import { dailyAggregation } from "../services/statistics/dailyAggregation";

describe("dailyAggregation — 단위 테스트", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("orgStats/{orgId}/monthly/{YYYY-MM} 문서에 monthlyTotal.count, costStats 등이 올바르게 합산되어 쓰이는지 검증", async () => {
        const YYYY_MM = "2026-06";
        
        await dailyAggregation(YYYY_MM);

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                monthlyTotal: {
                    count: 2
                },
                costStats: {
                    fuelCost: 80000,
                    tollCost: 1200
                },
                updatedAt: expect.any(String)
            }),
            { merge: true }
        );
    });
});
