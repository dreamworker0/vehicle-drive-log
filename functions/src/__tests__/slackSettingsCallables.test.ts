/**
 * slackSettingsCallables.test.ts — 설정 화면 콜러블 3종
 * (getSlackConnectionStatus / disconnectSlack / diagnoseSlackConnection)
 * 공통 검증: admin 게이트, 토큰·암호문 미노출, org 스코프.
 */
class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
// require 순서대로 핸들러 캡처: [status, disconnect, diagnose]
const capturedHandlers: any[] = [];
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: any, handler: any) => { capturedHandlers.push(handler); return handler; },
    HttpsError: MockHttpsError,
}));

const mockUsersGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ where: jest.fn().mockReturnThis(), get: mockUsersGet }),
    }),
    FieldValue: { delete: () => 'FIELD_DELETE', serverTimestamp: () => 'ts' },
}));
jest.mock('../core/params', () => ({
    SLACK_TOKEN_ENC_KEY: { value: () => 'enc-key' },
}));
const mockFind = jest.fn();
jest.mock('../services/slack/resolveSlackUser', () => ({
    findSlackIntegrationByOrg: (...args: unknown[]) => mockFind(...args),
}));
const mockDecrypt = jest.fn(() => 'xoxb-decrypted');
jest.mock('../services/slack/tokenCrypto', () => ({
    decryptSlackToken: (...args: unknown[]) => mockDecrypt(...args),
}));
const mockRevoke = jest.fn().mockResolvedValue(true);
const mockListEmails = jest.fn();
jest.mock('../services/slack/slackApi', () => ({
    authRevoke: (...args: unknown[]) => mockRevoke(...args),
    listSlackEmails: (...args: unknown[]) => mockListEmails(...args),
}));
jest.mock('../utils/helpers', () => ({ log: jest.fn() }));

require('../handlers/callable/getSlackConnectionStatus');
require('../handlers/callable/disconnectSlack');
require('../handlers/callable/diagnoseSlackConnection');
const [statusHandler, disconnectHandler, diagnoseHandler] = capturedHandlers;

const ADMIN_REQ = { auth: { uid: 'admin1', token: { role: 'admin', orgId: 'org1' } } };
const CIPHER = { v: 1, cipher: 'c', iv: 'i', authTag: 't' };

function integration(data: Record<string, unknown>) {
    return { teamId: 'T123', ref: { update: jest.fn().mockResolvedValue(undefined) }, data };
}

describe('설정 콜러블 공통 게이트', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        ['status', () => statusHandler], ['disconnect', () => disconnectHandler], ['diagnose', () => diagnoseHandler],
    ])('%s: 미인증이면 거부한다', async (_n, h) => {
        await expect(h()({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each([
        ['status', () => statusHandler], ['disconnect', () => disconnectHandler], ['diagnose', () => diagnoseHandler],
    ])('%s: 일반 직원(employee)이면 거부한다', async (_n, h) => {
        await expect(h()({ auth: { uid: 'u', token: { role: 'employee', orgId: 'org1' } } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });
});

describe('getSlackConnectionStatus', () => {
    beforeEach(() => jest.clearAllMocks());

    it('활성 연동이면 안전 필드만 반환한다 (토큰·암호문 미포함)', async () => {
        mockFind.mockResolvedValue(integration({
            enabled: true, tokenCipher: CIPHER, teamName: '사랑나눔', botUserId: 'B1',
            connectedAt: { toDate: () => new Date('2026-07-18T00:00:00Z') },
        }));

        const result = await statusHandler(ADMIN_REQ);

        expect(result).toEqual({
            connected: true, teamName: '사랑나눔', botUserId: 'B1',
            connectedAt: '2026-07-18T00:00:00.000Z',
        });
        expect(JSON.stringify(result)).not.toContain('cipher');
        expect(mockFind).toHaveBeenCalledWith('org1'); // 호출자 org로만 조회
    });

    it('연동 문서가 없으면 connected:false', async () => {
        mockFind.mockResolvedValue(null);
        expect(await statusHandler(ADMIN_REQ)).toEqual({ connected: false });
    });

    it('해제된 연동(enabled:false 또는 토큰 없음)은 미연결로 본다', async () => {
        mockFind.mockResolvedValue(integration({ enabled: false, tokenCipher: CIPHER }));
        expect(await statusHandler(ADMIN_REQ)).toEqual({ connected: false });

        mockFind.mockResolvedValue(integration({ enabled: true }));
        expect(await statusHandler(ADMIN_REQ)).toEqual({ connected: false });
    });
});

describe('disconnectSlack', () => {
    beforeEach(() => jest.clearAllMocks());

    it('revoke 후 토큰 삭제 + 비활성화한다', async () => {
        const intg = integration({ enabled: true, tokenCipher: CIPHER });
        mockFind.mockResolvedValue(intg);

        const result = await disconnectHandler(ADMIN_REQ);

        expect(mockDecrypt).toHaveBeenCalledWith('T123', CIPHER);
        expect(mockRevoke).toHaveBeenCalledWith('xoxb-decrypted');
        expect(intg.ref.update).toHaveBeenCalledWith(expect.objectContaining({
            tokenCipher: 'FIELD_DELETE', enabled: false, revoked: true,
        }));
        expect(result).toEqual({ success: true });
    });

    it('revoke가 실패해도 로컬 토큰은 삭제한다', async () => {
        const intg = integration({ enabled: true, tokenCipher: CIPHER });
        mockFind.mockResolvedValue(intg);
        mockRevoke.mockRejectedValueOnce(new Error('network'));

        // authRevoke 예외는 decrypt try 밖 — 코드상 authRevoke는 try 안이므로 삼켜진다
        await disconnectHandler(ADMIN_REQ);

        expect(intg.ref.update).toHaveBeenCalledWith(expect.objectContaining({ tokenCipher: 'FIELD_DELETE' }));
    });

    it('연동이 없으면 not-found', async () => {
        mockFind.mockResolvedValue(null);
        await expect(disconnectHandler(ADMIN_REQ)).rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('diagnoseSlackConnection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDecrypt.mockReturnValue('xoxb-decrypted');
    });

    it('직원 이메일을 워크스페이스 이메일과 대조한다 (불일치 우선 정렬)', async () => {
        mockFind.mockResolvedValue(integration({ enabled: true, tokenCipher: CIPHER }));
        mockListEmails.mockResolvedValue({ ok: true, emails: new Set(['a@org.kr', 'b@org.kr']) });
        mockUsersGet.mockResolvedValue({
            docs: [
                { data: () => ({ name: '김A', email: 'A@org.kr', organizationId: 'org1' }) }, // 대소문자 무시 매칭
                { data: () => ({ name: '박B', email: 'b@org.kr', organizationId: 'org1' }) },
                { data: () => ({ name: '이C', email: 'c@other.kr', organizationId: 'org1' }) },
                { data: () => ({ name: '탈퇴자', email: 'x@org.kr', status: 'disabled', organizationId: 'org1' }) },
            ],
        });

        const result = await diagnoseHandler(ADMIN_REQ);

        expect(result.ok).toBe(true);
        expect(result.staff).toEqual([
            { name: '이C', email: 'c@other.kr', matched: false }, // 불일치가 먼저
            { name: '김A', email: 'A@org.kr', matched: true },
            { name: '박B', email: 'b@org.kr', matched: true },
        ]);
    });

    it('Slack 응답 실패(토큰 죽음)면 unavailable', async () => {
        mockFind.mockResolvedValue(integration({ enabled: true, tokenCipher: CIPHER }));
        mockListEmails.mockResolvedValue({ ok: false, emails: new Set(), error: 'token_revoked' });

        await expect(diagnoseHandler(ADMIN_REQ)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('미연결이면 failed-precondition', async () => {
        mockFind.mockResolvedValue(null);
        await expect(diagnoseHandler(ADMIN_REQ)).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
