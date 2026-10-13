/**
 * orgRetirement.test.ts — 삭제 트리거가 "해지 기관의 파기"를 알아보는 판정
 */
const mockGet = jest.fn();
jest.mock("firebase-admin/firestore", () => ({
    getFirestore: () => ({ collection: () => ({ doc: () => ({ get: () => mockGet() }) }) }),
}));

import { isOrgRetired, _resetOrgRetirementCache } from "../utils/orgRetirement";

describe("isOrgRetired", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        _resetOrgRetirementCache();
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("운영 중인 기관은 해지가 아니다", async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: "approved" }) });
        expect(await isOrgRetired("org-A")).toBe(false);
    });

    it("status가 deleted면 해지 기관이다", async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: "deleted" }) });
        expect(await isOrgRetired("org-A")).toBe(true);
    });

    it("기관 문서가 없으면 해지 기관이다 — 파기는 기관 문서를 맨 마지막에 지운다", async () => {
        mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
        expect(await isOrgRetired("org-A")).toBe(true);
    });

    it("조회가 실패하면 해지 아님으로 둔다 — 정상 기관의 환불·km 보정을 막지 않는다", async () => {
        mockGet.mockRejectedValueOnce(new Error("UNAVAILABLE"));
        expect(await isOrgRetired("org-A")).toBe(false);
    });

    it.each([undefined, null, "", 42])("기관 ID가 없으면(%j) 조회하지 않고 해지 아님", async (orgId) => {
        expect(await isOrgRetired(orgId)).toBe(false);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("같은 기관은 잠깐 기억해 파기 중 트리거가 몰려도 매번 읽지 않는다", async () => {
        mockGet.mockResolvedValue({ exists: true, data: () => ({ status: "deleted" }) });
        await isOrgRetired("org-A");
        await isOrgRetired("org-A");
        expect(mockGet).toHaveBeenCalledTimes(1);
    });
});
