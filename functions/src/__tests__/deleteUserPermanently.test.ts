/**
 * deleteUserPermanently.test.ts
 * - 비활성 직원 완전 삭제(Hard Delete) onCall 함수 단위 테스트
 * - Firebase Admin Auth/Firestore는 mock 처리
 */

// ── 각 doc/쿼리에 대한 개별 mock 함수 ──
const mockCallerGet = jest.fn();
const mockTargetGet = jest.fn();
const mockUserDelete = jest.fn().mockResolvedValue(undefined);
const mockFavoritesGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockAuthDeleteUser = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        deleteUser: mockAuthDeleteUser,
    }),
}));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn((collectionName: string) => {
            if (collectionName === 'favorites') {
                return {
                    where: jest.fn(() => ({ get: mockFavoritesGet })),
                };
            }
            return {
                doc: jest.fn((docId: string) => {
                    if (docId === 'caller-uid') {
                        return { get: mockCallerGet };
                    }
                    return { get: mockTargetGet, delete: mockUserDelete };
                }),
            };
        }),
        batch: jest.fn(() => ({ delete: mockBatchDelete, commit: mockBatchCommit })),
    }),
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

import { deleteUserPermanently } from "../handlers/callable/deleteUserPermanently";

const handler = deleteUserPermanently as unknown as (req: Record<string, unknown>) => Promise<unknown>;

/** 즐겨찾기 스냅샷 mock 생성 헬퍼 */
function favSnap(count: number) {
    const docs = Array.from({ length: count }, (_, i) => ({ ref: `fav-ref-${i}` }));
    return { empty: count === 0, size: count, docs };
}

describe('deleteUserPermanently — 비활성 직원 완전 삭제', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserDelete.mockResolvedValue(undefined);
        mockBatchCommit.mockResolvedValue(undefined);
        mockAuthDeleteUser.mockResolvedValue(undefined);
        mockFavoritesGet.mockResolvedValue(favSnap(0));
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('uid가 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid', token: {} }, data: {} };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('자기 자신을 삭제하면 failed-precondition 에러를 던진다', async () => {
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

    it('다른 기관 직원을 삭제하면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org2', status: 'disabled' }),
        });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('superAdmin 계정을 삭제하면 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'superAdmin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'superAdmin', organizationId: 'org1', status: 'disabled' }),
        });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('비활성 상태가 아닌 직원을 삭제하면 failed-precondition 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org1', status: 'active' }),
        });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockUserDelete).not.toHaveBeenCalled();
        expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    });

    it('정상 처리: 비활성 직원을 삭제하면 users 문서 + 즐겨찾기 + Auth 계정을 삭제한다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org1', status: 'disabled' }),
        });
        mockFavoritesGet.mockResolvedValueOnce(favSnap(3));

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockBatchDelete).toHaveBeenCalledTimes(3);
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);
        expect(mockUserDelete).toHaveBeenCalledTimes(1);
        expect(mockAuthDeleteUser).toHaveBeenCalledWith('target-uid');
    });

    it('Auth 계정이 없어도(auth/user-not-found) Firestore 삭제는 성공 처리한다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin', organizationId: 'org1' }),
        });
        mockTargetGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org1', status: 'disabled' }),
        });
        mockAuthDeleteUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockUserDelete).toHaveBeenCalled();
    });
});
