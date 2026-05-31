/**
 * disableUser.test.ts
 * - 직원 비활성화(Soft Delete) onCall 함수 단위 테스트
 * - Firebase Admin Auth/Firestore는 mock 처리
 */

// ── 각 doc에 대한 개별 mock 함수 ──
const mockCallerGet = jest.fn();
const mockTargetGet = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn((docId: string) => {
                if (docId === 'caller-uid') {
                    return { get: mockCallerGet, update: jest.fn() };
                }
                // target-uid: get + update 모두 제공
                return { get: mockTargetGet, update: mockUpdate };
            }),
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

import { disableUser } from '../disableUser';

const handler = disableUser as unknown as (req: Record<string, unknown>) => Promise<unknown>;

describe('disableUser — 직원 비활성화', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate.mockResolvedValue(undefined);
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('uid가 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid', token: {} }, data: {} };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('자기 자신을 비활성화하면 failed-precondition 에러를 던진다', async () => {
        const req = { auth: { uid: 'same-uid', token: {} }, data: { uid: 'same-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('호출자가 admin이 아니면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'employee', organizationId: 'org1' }),
        });
        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('대상 사용자가 존재하지 않으면 not-found 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({ exists: false, data: () => null });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('다른 기관 직원을 비활성화하면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org2' }),
        });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('정상 처리: 같은 기관의 직원을 비활성화하면 update를 호출하고 success: true를 반환한다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org1' }),
        });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockUpdate).toHaveBeenCalledWith({
            status: 'disabled',
            disabledAt: 'SERVER_TIMESTAMP',
        });
    });
});
