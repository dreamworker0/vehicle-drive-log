/**
 * restoreUser.test.ts
 * - 비활성화된 계정 복원 onCall 함수 단위 테스트
 * - Firebase Admin Auth/Firestore는 mock 처리
 */

// ── Auth Mock ──
const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({
        getUserByEmail: mockGetUserByEmail,
        updateUser: mockUpdateUser,
    }),
}));

// ── Firestore Mock ──
const mockCallerGet = jest.fn();
const mockOrgGet = jest.fn();
const mockUserSet = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn((col: string) => ({
            doc: jest.fn((docId: string) => {
                if (col === 'users' && docId === 'caller-uid') return { get: mockCallerGet };
                if (col === 'organizations') return { get: mockOrgGet };
                return { get: jest.fn().mockResolvedValue({ exists: false }), set: mockUserSet };
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

import { restoreUser } from "../handlers/callable/restoreUser";

const handler = restoreUser as unknown as (req: Record<string, unknown>) => Promise<unknown>;

describe('restoreUser — 계정 복원', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: { email: 'user@test.com', organizationId: 'org1' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('email이 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid', token: {} }, data: { organizationId: 'org1' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('organizationId가 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'caller-uid', token: {} }, data: { email: 'user@test.com' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('superAdmin이 아닌 호출자는 permission-denied 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'admin' }),
        });
        const req = {
            auth: { uid: 'caller-uid', token: {} },
            data: { email: 'user@test.com', organizationId: 'org1' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('유효하지 않은 기관이면 not-found 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'superAdmin' }),
        });
        mockOrgGet.mockResolvedValueOnce({ exists: false });

        const req = {
            auth: { uid: 'caller-uid', token: {} },
            data: { email: 'user@test.com', organizationId: 'org1' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('Firebase Auth에 사용자가 없으면 not-found 에러를 던진다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'superAdmin' }),
        });
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        mockGetUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        const req = {
            auth: { uid: 'caller-uid', token: {} },
            data: { email: 'notfound@test.com', organizationId: 'org1' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('정상 처리: disabled 사용자를 복원하면 Auth 재활성화 + Firestore 문서 재생성을 한다', async () => {
        mockCallerGet.mockResolvedValueOnce({
            data: () => ({ role: 'superAdmin' }),
        });
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        mockGetUserByEmail.mockResolvedValueOnce({
            uid: 'target-uid',
            disabled: true, // 비활성화된 상태
            displayName: '홍길동',
        });
        mockUpdateUser.mockResolvedValueOnce(undefined);
        mockUserSet.mockResolvedValueOnce(undefined);

        const req = {
            auth: { uid: 'caller-uid', token: {} },
            data: { email: 'disabled@test.com', organizationId: 'org1', name: '홍길동', role: 'employee' },
        };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.success).toBe(true);
        expect(result.uid).toBe('target-uid');
        expect(result.email).toBe('disabled@test.com');
        // Auth 재활성화 확인
        expect(mockUpdateUser).toHaveBeenCalledWith('target-uid', { disabled: false });
        // Firestore 문서 재생성 확인
        expect(mockUserSet).toHaveBeenCalledWith(expect.objectContaining({
            email: 'disabled@test.com',
            organizationId: 'org1',
            role: 'employee',
        }));
    });
});
