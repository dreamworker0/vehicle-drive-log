/**
 * slackOauthCallback.test.ts — OAuth 콜백 (state 검증·nonce 소비·code 교환·토큰 저장)
 * state 서명은 실제 oauthState를 사용하고, Firestore·Slack API·암호화는 mock.
 */
let capturedHandler: any;
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (_options: any, handler: any) => { capturedHandler = handler; },
}));

// ── Firestore Mock (runTransaction + integrations doc) ──
const mockStateGet = jest.fn();
const mockTxDelete = jest.fn();
const mockIntgGet = jest.fn();
const mockIntgSet = jest.fn().mockResolvedValue(undefined);
const mockRunTransaction = jest.fn(async (cb: any) => cb({ get: async () => mockStateGet(), delete: mockTxDelete }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: () => (name === 'integrations' ? { get: mockIntgGet, set: mockIntgSet } : {}),
        }),
        runTransaction: (cb: any) => mockRunTransaction(cb),
    }),
    FieldValue: { serverTimestamp: () => 'ts' },
}));

const STATE_SECRET = 'state-secret';
jest.mock('../core/params', () => ({
    SLACK_CLIENT_ID: { value: () => 'client-id' },
    SLACK_CLIENT_SECRET: { value: () => 'client-secret' },
    SLACK_STATE_SECRET: { value: () => 'state-secret' },
    SLACK_TOKEN_ENC_KEY: { value: () => 'enc-key' },
}));
const mockOauthV2Access = jest.fn();
jest.mock('../services/slack/slackApi', () => ({
    oauthV2Access: (...args: unknown[]) => mockOauthV2Access(...args),
}));
const mockEncrypt = jest.fn(() => ({ v: 1, cipher: 'c', iv: 'i', authTag: 't' }));
jest.mock('../services/slack/tokenCrypto', () => ({
    encryptSlackToken: (...args: unknown[]) => mockEncrypt(...args),
}));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByIp: jest.fn().mockResolvedValue(false),
}));

import { signState, type OAuthStatePayload } from "../services/slack/oauthState";
require('../handlers/https/slackOauthCallback');

function freshState(overrides: Partial<OAuthStatePayload> = {}): string {
    const payload: OAuthStatePayload = {
        organizationId: 'org1', uid: 'user1', nonce: 'nonce-1',
        iat: Math.floor(Date.now() / 1000), ...overrides,
    };
    return signState(payload, STATE_SECRET);
}

function makeReq(query: Record<string, string>, method = 'GET') {
    return { method, query, ip: '1.2.3.4', headers: {}, path: '/slackOauthCallback' };
}
function makeRes() {
    return {
        redirectedTo: undefined as string | undefined,
        statusCode: 0,
        redirect(code: number, url: string) { this.statusCode = code; this.redirectedTo = url; },
        status(code: number) { this.statusCode = code; return this; },
        send() { /* noop */ },
    };
}

const OK_OAUTH = { ok: true, accessToken: 'xoxb-new', teamId: 'T999', teamName: '새기관', botUserId: 'B1', scope: 'chat:write' };

describe('slackOauthCallback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        mockStateGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }) });
        mockIntgGet.mockResolvedValue({ exists: false });
        mockOauthV2Access.mockResolvedValue(OK_OAUTH);
    });
    afterEach(() => jest.restoreAllMocks());

    it('정상: state 검증→nonce 소비→토큰 교환→암호화 저장→connected 리다이렉트', async () => {
        const res = makeRes();
        await capturedHandler(makeReq({ code: 'the-code', state: freshState() }), res);

        expect(mockTxDelete).toHaveBeenCalled(); // nonce 소비
        expect(mockOauthV2Access).toHaveBeenCalledWith('client-id', 'client-secret', 'the-code', expect.stringContaining('slackOauthCallback'));
        expect(mockEncrypt).toHaveBeenCalledWith('T999', 'xoxb-new'); // 기관별 AAD로 암호화
        expect(mockIntgSet).toHaveBeenCalledWith(expect.objectContaining({
            platform: 'slack', teamId: 'T999', organizationId: 'org1', enabled: true,
            tokenCipher: { v: 1, cipher: 'c', iv: 'i', authTag: 't' },
        }), { merge: true });
        expect(res.redirectedTo).toContain('slack=connected');
    });

    it('state가 위조/누락이면 exchange 없이 에러 리다이렉트', async () => {
        const res = makeRes();
        await capturedHandler(makeReq({ code: 'x', state: 'tampered.sig' }), res);

        expect(mockOauthV2Access).not.toHaveBeenCalled();
        expect(res.redirectedTo).toContain('slack=error');
        expect(res.redirectedTo).toContain('invalid_state');
    });

    it('이미 사용된 nonce(재생)면 거부한다', async () => {
        mockStateGet.mockResolvedValue({ exists: false }); // 소비 대상 없음
        const res = makeRes();
        await capturedHandler(makeReq({ code: 'x', state: freshState() }), res);

        expect(mockOauthV2Access).not.toHaveBeenCalled();
        expect(res.redirectedTo).toContain('used_or_expired');
    });

    it('워크스페이스가 다른 기관에 이미 연결돼 있으면 거부한다', async () => {
        mockIntgGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'OTHER_ORG' }) });
        const res = makeRes();
        await capturedHandler(makeReq({ code: 'x', state: freshState() }), res);

        expect(mockIntgSet).not.toHaveBeenCalled();
        expect(res.redirectedTo).toContain('already_linked');
    });

    it('code 교환 실패면 저장 없이 에러 리다이렉트', async () => {
        mockOauthV2Access.mockResolvedValue({ ok: false, accessToken: null, teamId: null, error: 'invalid_code' });
        const res = makeRes();
        await capturedHandler(makeReq({ code: 'bad', state: freshState() }), res);

        expect(mockIntgSet).not.toHaveBeenCalled();
        expect(res.redirectedTo).toContain('exchange_failed');
    });

    it('사용자가 설치를 취소하면(error 파라미터) 안내 리다이렉트', async () => {
        const res = makeRes();
        await capturedHandler(makeReq({ error: 'access_denied' }), res);

        expect(mockOauthV2Access).not.toHaveBeenCalled();
        expect(res.redirectedTo).toContain('cancelled');
    });
});
