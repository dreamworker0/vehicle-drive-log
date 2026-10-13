/**
 * purgeOrganization.test.ts — 기관 즉시 파기 콜러블의 권한·입력·오류 변환
 *
 * 파기 범위 자체는 purgeOrganizationData.emulator.test.ts가 실제 Firestore로 검증한다.
 */
const mockPurge = jest.fn();
jest.mock("../services/organization/purgeOrganizationData", () => {
    class OrgNotRetiredError extends Error {}
    return {
        purgeOrganizationData: (...args: unknown[]) => mockPurge(...args),
        OrgNotRetiredError,
    };
});
jest.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: () => ({ name: "default-bucket" }) }) }));
const mockCaptureError = jest.fn();
jest.mock("../core/sentry", () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
    flushSentry: jest.fn().mockResolvedValue(undefined),
}));

import { purgeOrganization } from "../handlers/callable/purgeOrganization";
import { OrgNotRetiredError } from "../services/organization/purgeOrganizationData";

type Callable = { run: (req: unknown) => Promise<unknown> };
const invoke = (data: unknown, auth: unknown) => (purgeOrganization as unknown as Callable).run({ data, auth });

const superAdmin = { uid: "sa-1", token: { role: "superAdmin" } };

describe("purgeOrganization — 기관 즉시 파기 콜러블", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    it("비인증 호출을 거부한다", async () => {
        await expect(invoke({ orgId: "org-A" }, null)).rejects.toThrow(/로그인/);
        expect(mockPurge).not.toHaveBeenCalled();
    });

    it("기관 관리자도 거부한다 — superAdmin 전용", async () => {
        await expect(invoke({ orgId: "org-A" }, { uid: "u1", token: { role: "admin", orgId: "org-A" } }))
            .rejects.toThrow(/시스템 관리자/);
        expect(mockPurge).not.toHaveBeenCalled();
    });

    it.each([undefined, "", "  ", 42])("기관 ID가 없거나 문자열이 아니면(%j) 거부한다", async (orgId) => {
        await expect(invoke({ orgId }, superAdmin)).rejects.toThrow(/기관 ID/);
        expect(mockPurge).not.toHaveBeenCalled();
    });

    it("파기하고 삭제 건수를 돌려준다", async () => {
        mockPurge.mockResolvedValueOnce({ orgId: "org-A", deleted: { driveLogs: 5 }, storagePrefix: "organizations/org-A/" });

        const res = await invoke({ orgId: "org-A" }, superAdmin);

        expect(mockPurge).toHaveBeenCalledWith("org-A", { name: "default-bucket" });
        expect(res).toEqual({ success: true, deleted: { driveLogs: 5 } });
    });

    it("해지되지 않은 기관이면 failed-precondition으로 알린다 (오류 보고 없음)", async () => {
        mockPurge.mockRejectedValueOnce(new OrgNotRetiredError("org-A"));

        await expect(invoke({ orgId: "org-A" }, superAdmin)).rejects.toMatchObject({ code: "failed-precondition" });
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it("그 밖의 실패는 보고하고 internal로 알린다", async () => {
        mockPurge.mockRejectedValueOnce(new Error("DEADLINE_EXCEEDED"));

        await expect(invoke({ orgId: "org-A" }, superAdmin)).rejects.toMatchObject({ code: "internal" });
        expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error), { context: "purgeOrganization", orgId: "org-A" });
    });
});
