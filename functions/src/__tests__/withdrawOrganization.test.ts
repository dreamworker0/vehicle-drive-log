/**
 * withdrawOrganization.test.ts
 * - 기관 자발적 서비스 해지 onCall 함수 단위 테스트
 * - Firebase Admin Firestore는 mock 처리
 */

const mockCallerGet = jest.fn();
const mockOrgGet = jest.fn();
const mockUsersWhereGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn((name: string) => {
            if (name === 'organizations') {
                return { doc: jest.fn(() => ({ get: mockOrgGet })) };
            }
            // users
            return {
                doc: jest.fn(() => ({ get: mockCallerGet })),
                where: jest.fn(() => ({ get: mockUsersWhereGet })),
            };
        }),
        batch: jest.fn(() => ({
            delete: mockBatchDelete,
            update: mockBatchUpdate,
            commit: mockBatchCommit,
        })),
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { withdrawOrganization } from "../handlers/callable/withdrawOrganization";

const handler = withdrawOrganization as unknown as (req: Record<string, unknown>) => Promise<unknown>;

const validData = { organizationId: 'org1', reason: 'no_longer_needed' };

describe('withdrawOrganization — 기관 서비스 해지', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBatchCommit.mockResolvedValue(undefined);
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: validData };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('organizationId가 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid' }, data: { reason: 'no_longer_needed' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('사유가 유효하지 않으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid' }, data: { organizationId: 'org1', reason: 'bogus' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('호출자가 admin이 아니면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'employee', organizationId: 'org1' }) });
        const req = { auth: { uid: 'caller-uid' }, data: validData };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('다른 기관을 해지하려 하면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', organizationId: 'org2' }) });
        const req = { auth: { uid: 'caller-uid' }, data: validData };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('기관이 존재하지 않으면 not-found 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', organizationId: 'org1' }) });
        mockOrgGet.mockResolvedValueOnce({ exists: false, data: () => null });
        const req = { auth: { uid: 'caller-uid' }, data: validData };
        await expect(handler(req)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('이미 해지된 기관이면 failed-precondition 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', organizationId: 'org1' }) });
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'deleted' }) });
        const req = { auth: { uid: 'caller-uid' }, data: validData };
        await expect(handler(req)).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('정상 처리: 직원 문서를 삭제하고 status=deleted, deletedBy=admin으로 갱신한다', async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', organizationId: 'org1' }) });
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        mockUsersWhereGet.mockResolvedValueOnce({ docs: [{ ref: 'u1' }, { ref: 'u2' }], size: 2 });

        const req = { auth: { uid: 'caller-uid' }, data: validData };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockBatchDelete).toHaveBeenCalledTimes(2);
        expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), {
            status: 'deleted',
            deletedAt: 'SERVER_TIMESTAMP',
            deletedBy: 'admin',
            withdrawReason: 'no_longer_needed',
        });
        expect(mockBatchCommit).toHaveBeenCalled();
    });

    it("사유가 'other'이면 withdrawReasonDetail을 저장한다", async () => {
        mockCallerGet.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin', organizationId: 'org1' }) });
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        mockUsersWhereGet.mockResolvedValueOnce({ docs: [], size: 0 });

        const req = { auth: { uid: 'caller-uid' }, data: { organizationId: 'org1', reason: 'other', reasonDetail: '  예산 문제  ' } };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), {
            status: 'deleted',
            deletedAt: 'SERVER_TIMESTAMP',
            deletedBy: 'admin',
            withdrawReason: 'other',
            withdrawReasonDetail: '예산 문제',
        });
    });
});
