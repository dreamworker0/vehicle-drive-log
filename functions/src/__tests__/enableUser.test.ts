/**
 * enableUser.test.ts
 * - 비활성 직원 다시 활성화 onCall 함수 단위 테스트
 * - Firebase Admin Auth/Firestore는 mock 처리
 */

const mockCallerGet = jest.fn();
const mockTargetGet = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockAuthUpdateUser = jest.fn().mockResolvedValue(undefined);
// 호출 순서 확인용 — Auth 해제가 문서 복구보다 먼저여야 한다
const callOrder: string[] = [];

jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        updateUser: (...args: unknown[]) => {
            callOrder.push('auth');
            return mockAuthUpdateUser(...args);
        },
    }),
}));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn((docId: string) => {
                if (docId === 'caller-uid') {
                    return { get: mockCallerGet, update: jest.fn() };
                }
                return {
                    get: mockTargetGet,
                    update: (...args: unknown[]) => {
                        callOrder.push('doc');
                        return mockUpdate(...args);
                    },
                };
            }),
        })),
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

import { enableUser } from "../handlers/callable/enableUser";

const handler = enableUser as unknown as (req: Record<string, unknown>) => Promise<unknown>;
const req = { auth: { uid: 'caller-uid', token: {} }, data: { uid: 'target-uid' } };

const callerIs = (role: string, organizationId: string | null = 'org1') =>
    mockCallerGet.mockResolvedValueOnce({ data: () => ({ role, organizationId }) });
const targetIs = (data: Record<string, unknown> | null) =>
    mockTargetGet.mockResolvedValueOnce({ exists: data !== null, data: () => data });

describe('enableUser — 직원 다시 활성화', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        callOrder.length = 0;
        mockUpdate.mockResolvedValue(undefined);
        mockAuthUpdateUser.mockResolvedValue(undefined);
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        await expect(handler({ auth: null, data: { uid: 'target-uid' } })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('uid가 없으면 invalid-argument 에러를 던진다', async () => {
        await expect(handler({ auth: { uid: 'caller-uid', token: {} }, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('호출자가 관리자가 아니면 permission-denied — Auth·문서 모두 건드리지 않는다', async () => {
        callerIs('employee');
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockAuthUpdateUser).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('대상 사용자 문서가 없으면 not-found', async () => {
        callerIs('admin');
        targetIs(null);
        await expect(handler(req)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('다른 기관 직원이면 permission-denied — Auth를 풀지 않는다', async () => {
        callerIs('admin', 'org1');
        targetIs({ role: 'employee', organizationId: 'org2', status: 'disabled' });
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockAuthUpdateUser).not.toHaveBeenCalled();
    });

    it('기관 미소속 관리자가 미소속 문서를 고치지 못한다 (null == null 우회 차단)', async () => {
        callerIs('admin', null);
        targetIs({ role: 'employee', organizationId: null, status: 'disabled' });
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('관리자는 시스템 관리자 계정을 활성화할 수 없다', async () => {
        callerIs('admin');
        targetIs({ role: 'superAdmin', organizationId: 'org1', status: 'disabled' });
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('정상 처리: Auth 차단을 먼저 풀고 문서를 active로 되돌린다 (행위자 스탬프 포함)', async () => {
        callerIs('admin');
        targetIs({ role: 'employee', organizationId: 'org1', status: 'disabled' });

        await expect(handler(req)).resolves.toEqual({ success: true });

        expect(mockAuthUpdateUser).toHaveBeenCalledWith('target-uid', { disabled: false });
        expect(mockUpdate).toHaveBeenCalledWith({
            status: 'active',
            disabledAt: null,
            lastEditedByUid: 'caller-uid',
        });
        expect(callOrder).toEqual(['auth', 'doc']);
    });

    it('superAdmin은 다른 기관 직원도 활성화할 수 있다', async () => {
        callerIs('superAdmin', null);
        targetIs({ role: 'employee', organizationId: 'org9', status: 'disabled' });
        await expect(handler(req)).resolves.toEqual({ success: true });
        expect(mockAuthUpdateUser).toHaveBeenCalledWith('target-uid', { disabled: false });
    });

    it('문서는 이미 active인데 Auth만 막힌 계정(과거 반쪽 복구)도 풀린다', async () => {
        callerIs('admin');
        targetIs({ role: 'employee', organizationId: 'org1', status: 'active' });
        await expect(handler(req)).resolves.toEqual({ success: true });
        expect(mockAuthUpdateUser).toHaveBeenCalledWith('target-uid', { disabled: false });
    });

    it('Auth 계정이 없으면(auth/user-not-found) 문서만 복구하고 성공한다', async () => {
        callerIs('admin');
        targetIs({ role: 'employee', organizationId: 'org1', status: 'disabled' });
        mockAuthUpdateUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        await expect(handler(req)).resolves.toEqual({ success: true });
        expect(mockUpdate).toHaveBeenCalled();
    });

    it('Auth 해제가 다른 이유로 실패하면 문서를 고치지 않고 internal로 실패한다', async () => {
        callerIs('admin');
        targetIs({ role: 'employee', organizationId: 'org1', status: 'disabled' });
        mockAuthUpdateUser.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'auth/internal-error' }));

        await expect(handler(req)).rejects.toMatchObject({ code: 'internal' });
        // 문서만 active가 되는 '보이지 않는 반쪽 복구'를 만들지 않는다
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
