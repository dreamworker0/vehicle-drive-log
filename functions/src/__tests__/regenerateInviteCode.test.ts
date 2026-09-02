/**
 * regenerateInviteCode.test.ts — 기관 초대 코드 재발급 콜러블
 *
 * 고정하는 계약 (2026-09-02, Rules가 기관관리자의 inviteCode 쓰기를 닫으면서 서버로 이관):
 *   - 권한은 커스텀 클레임으로 본다: 해당 기관 admin 또는 superAdmin. 다른 기관 admin·employee는 거부
 *   - 승인된 기관만 대상
 *   - 코드는 서버 난수이며, 다른 기관(상태 무관)과 겹치면 새로 뽑는다
 *   - 클라이언트가 값을 고를 수 없다 — 요청 본문에 코드를 넣어도 무시된다
 */

// ── 공통 래퍼 의존성 mock ──
const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: mockCheckRateLimit,
}));
jest.mock('../utils/constants', () => ({
    getRateLimits: jest.fn().mockResolvedValue({ max: 5, windowSec: 3600 }),
}));
jest.mock('../core/sentry', () => ({
    captureError: jest.fn(),
    flushSentry: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

// ── 난수 생성기 mock — 충돌 재시도를 결정적으로 검사한다 ──
const mockGenerateInviteCode = jest.fn();
jest.mock('../utils/inviteCode', () => ({
    generateInviteCode: mockGenerateInviteCode,
}));

// ── Firestore mock ──
const mockOrgGet = jest.fn();
const mockOrgUpdate = jest.fn().mockResolvedValue(undefined);
const mockDupGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ get: mockOrgGet, update: mockOrgUpdate })),
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockDupGet })) })),
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

import { regenerateInviteCode } from '../handlers/callable/regenerateInviteCode';

const handler = regenerateInviteCode as unknown as (req: Record<string, unknown>) => Promise<{ inviteCode: string }>;

const approvedOrg = { exists: true, data: () => ({ status: 'approved', inviteCode: 'OLD123' }) };
const adminOfOrg1 = { uid: 'admin1', token: { role: 'admin', orgId: 'org1' } };

describe('regenerateInviteCode — 초대 코드 재발급', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOrgGet.mockResolvedValue(approvedOrg);
        mockDupGet.mockResolvedValue({ empty: true });
        mockGenerateInviteCode.mockReturnValue('NEWCOD');
    });

    it('인증이 없으면 unauthenticated (공통 래퍼)', async () => {
        await expect(handler({ auth: null, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('organizationId가 없거나 문자열이 아니면 invalid-argument', async () => {
        await expect(handler({ auth: adminOfOrg1, data: {} }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ auth: adminOfOrg1, data: { organizationId: 42 } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('다른 기관의 admin은 permission-denied — 클레임 orgId가 요청 기관과 달라야 막힌다', async () => {
        await expect(handler({ auth: { uid: 'adminB', token: { role: 'admin', orgId: 'org2' } }, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockOrgGet).not.toHaveBeenCalled();
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('같은 기관이라도 employee는 permission-denied', async () => {
        await expect(handler({ auth: { uid: 'emp1', token: { role: 'employee', orgId: 'org1' } }, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('기관이 없으면 not-found, 승인 전이면 failed-precondition', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: false });
        await expect(handler({ auth: adminOfOrg1, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'not-found' });

        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending' }) });
        await expect(handler({ auth: adminOfOrg1, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('해당 기관 admin: 서버 난수를 저장하고 반환한다. 요청 본문의 코드는 무시된다', async () => {
        const result = await handler({ auth: adminOfOrg1, data: { organizationId: 'org1', inviteCode: 'BBBBBB' } });
        expect(result).toEqual({ inviteCode: 'NEWCOD' });
        expect(mockOrgUpdate).toHaveBeenCalledWith({ inviteCode: 'NEWCOD' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith('regenerateInviteCode', 'admin1', 5, 3600, undefined);
    });

    it('superAdmin은 소속 기관이 아니어도 재발급할 수 있다', async () => {
        const result = await handler({ auth: { uid: 'super1', token: { role: 'superAdmin' } }, data: { organizationId: 'org1' } });
        expect(result).toEqual({ inviteCode: 'NEWCOD' });
    });

    it('다른 기관과 겹치는 코드는 버리고 새로 뽑는다 — 첫 후보 충돌, 둘째 후보 저장', async () => {
        mockGenerateInviteCode.mockReturnValueOnce('DUPDUP').mockReturnValueOnce('FRESH1');
        mockDupGet.mockResolvedValueOnce({ empty: false }).mockResolvedValueOnce({ empty: true });

        const result = await handler({ auth: adminOfOrg1, data: { organizationId: 'org1' } });
        expect(result).toEqual({ inviteCode: 'FRESH1' });
        expect(mockGenerateInviteCode).toHaveBeenCalledTimes(2);
        expect(mockOrgUpdate).toHaveBeenCalledWith({ inviteCode: 'FRESH1' });
    });

    it('5회 연속 충돌이면 internal — 조용히 겹치는 코드를 저장하지 않는다', async () => {
        mockDupGet.mockResolvedValue({ empty: false });
        await expect(handler({ auth: adminOfOrg1, data: { organizationId: 'org1' } }))
            .rejects.toMatchObject({ code: 'internal' });
        expect(mockGenerateInviteCode).toHaveBeenCalledTimes(5);
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });
});
