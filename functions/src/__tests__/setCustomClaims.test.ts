/**
 * setCustomClaims.test.ts
 * - 사용자 문서 변경 시 Custom Claims 자동 설정 로직 테스트
 * - getAuth().setCustomUserClaims mock 처리
 */

// ── Firebase Auth Mock ──
const mockSetCustomUserClaims = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/auth', () => ({
    getAuth: jest.fn(() => ({
        setCustomUserClaims: mockSetCustomUserClaims,
    })),
}));

jest.mock('firebase-functions/firestore', () => ({
    onDocumentWritten: (_options: any, handler: any) => {
        capturedHandler = handler;
    },
}));

let capturedHandler: any;

// 모듈 로드 (capturedHandler에 핸들러 저장)
require('../setCustomClaims');

import { getAuth } from 'firebase-admin/auth';

// ──────────────────────────────────────────────────
describe('setCustomClaims — Custom Claims 자동 설정', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('문서 삭제 시 (after=null) Claims를 빈 객체로 초기화', async () => {
        const event = {
            params: { uid: 'user-123' },
            data: {
                before: { data: () => ({ role: 'admin', organizationId: 'org1' }) },
                after: { data: () => null },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-123', {});
    });

    it('새 문서 생성 시 role과 orgId Claims 설정', async () => {
        const event = {
            params: { uid: 'user-456' },
            data: {
                before: { data: () => null },
                after: {
                    data: () => ({
                        role: 'manager',
                        organizationId: 'org2',
                    }),
                },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-456', {
            role: 'manager',
            orgId: 'org2',
        });
    });

    it('role, orgId 변경이 없으면 setCustomUserClaims 호출 안 함 (불필요한 업데이트 방지)', async () => {
        const event = {
            params: { uid: 'user-789' },
            data: {
                before: {
                    data: () => ({
                        role: 'employee',
                        organizationId: 'org3',
                        displayName: '이름변경전',
                    }),
                },
                after: {
                    data: () => ({
                        role: 'employee',
                        organizationId: 'org3',
                        displayName: '이름변경후',
                    }),
                },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('role이 변경되면 Claims 업데이트', async () => {
        const event = {
            params: { uid: 'user-101' },
            data: {
                before: {
                    data: () => ({
                        role: 'employee',
                        organizationId: 'org4',
                    }),
                },
                after: {
                    data: () => ({
                        role: 'manager',
                        organizationId: 'org4',
                    }),
                },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-101', {
            role: 'manager',
            orgId: 'org4',
        });
    });

    it('orgId가 없을 때 role만 있으면 orgId는 null로 설정', async () => {
        const event = {
            params: { uid: 'user-202' },
            data: {
                before: { data: () => null },
                after: {
                    data: () => ({
                        role: 'super_admin',
                    }),
                },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-202', {
            role: 'super_admin',
            orgId: null,
        });
    });

    it('role이 없으면 기본값 "employee"로 설정', async () => {
        const event = {
            params: { uid: 'user-303' },
            data: {
                before: { data: () => null },
                after: {
                    data: () => ({
                        organizationId: 'org5',
                    }),
                },
            },
        };

        await capturedHandler(event);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-303', {
            role: 'employee',
            orgId: 'org5',
        });
    });

    it('auth/user-not-found 에러 발생 시 경고 로그 후 정상 종료', async () => {
        mockSetCustomUserClaims.mockRejectedValueOnce({ code: 'auth/user-not-found' });

        const event = {
            params: { uid: 'ghost-user' },
            data: {
                before: { data: () => null },
                after: {
                    data: () => ({
                        role: 'employee',
                        organizationId: 'org6',
                    }),
                },
            },
        };

        await expect(capturedHandler(event)).resolves.not.toThrow();
        expect(console.warn).toHaveBeenCalled();
    });
});
