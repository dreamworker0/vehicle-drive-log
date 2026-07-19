/**
 * slackEvents.test.ts — Slack 수신 엔드포인트 (서명 검증·멱등 큐잉·분기)
 */
import { createHmac } from "node:crypto";

// ── onRequest 캡처 Mock ──
let capturedHandler: any;
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (_options: any, handler: any) => {
        capturedHandler = handler;
    },
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) { super(message); this.code = code; }
    },
}));

// ── Firestore Mock ──
const mockCreate = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ create: mockCreate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: jest.fn(() => 'mock-timestamp') },
}));

// ── 시크릿·rate limit Mock ──
const SECRET = 'test-signing-secret';
jest.mock('../core/params', () => ({
    SLACK_SIGNING_SECRET: { value: () => 'test-signing-secret' },
}));
const mockCheckRateLimitByIp = jest.fn().mockResolvedValue(false);
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByIp: (...args: unknown[]) => mockCheckRateLimitByIp(...args),
}));

require('../handlers/https/slackEvents');

// ── 요청/응답 헬퍼 ──
function signedHeaders(rawBody: string): Record<string, string> {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${rawBody}`).digest('hex');
    return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig };
}

function makeReq(rawBody: string, body: unknown, opts: { method?: string; headers?: Record<string, string> } = {}) {
    return {
        method: opts.method || 'POST',
        headers: opts.headers ?? signedHeaders(rawBody),
        body,
        rawBody: Buffer.from(rawBody),
        ip: '1.2.3.4',
        path: '/slackEvents',
    };
}

function makeRes() {
    return {
        statusCode: 0,
        payload: undefined as unknown,
        headersSent: false,
        status(code: number) { this.statusCode = code; return this; },
        json(v: unknown) { this.payload = v; this.headersSent = true; },
        send(v: unknown) { this.payload = v; this.headersSent = true; },
    };
}

const DM_EVENT = {
    type: 'event_callback',
    event_id: 'Ev123',
    team_id: 'T123',
    event: { type: 'message', channel_type: 'im', user: 'U123', channel: 'D123', text: '오늘 예약 현황' },
};

describe('slackEvents', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('url_verification이면 challenge를 에코한다', async () => {
        const raw = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
        const res = makeRes();
        await capturedHandler(makeReq(raw, JSON.parse(raw)), res);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ challenge: 'abc' });
    });

    it('서명이 위조되면 401을 반환하고 task를 만들지 않는다', async () => {
        const raw = JSON.stringify(DM_EVENT);
        const res = makeRes();
        const headers = signedHeaders(raw);
        headers['x-slack-signature'] = 'v0=' + '0'.repeat(64);
        await capturedHandler(makeReq(raw, JSON.parse(raw), { headers }), res);

        expect(res.statusCode).toBe(401);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockCheckRateLimitByIp).toHaveBeenCalled();
    });

    it('DM 메시지 이벤트는 event_id로 task 문서를 만들고 200을 반환한다', async () => {
        const raw = JSON.stringify(DM_EVENT);
        const res = makeRes();
        await capturedHandler(makeReq(raw, JSON.parse(raw)), res);

        expect(res.statusCode).toBe(200);
        expect(mockDoc).toHaveBeenCalledWith('Ev123');
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'message',
            teamId: 'T123',
            slackUserId: 'U123',
            channel: 'D123',
            text: '오늘 예약 현황',
            status: 'queued',
        }));
    });

    it('중복 이벤트(already-exists)는 조용히 200으로 ack한다 (Slack 재시도 멱등)', async () => {
        mockCreate.mockRejectedValueOnce({ code: 6, message: 'ALREADY_EXISTS' });
        const raw = JSON.stringify(DM_EVENT);
        const res = makeRes();
        await capturedHandler(makeReq(raw, JSON.parse(raw)), res);

        expect(res.statusCode).toBe(200);
    });

    it('봇 자기 메시지(bot_id)는 task를 만들지 않는다 (루프 방지)', async () => {
        const body = { ...DM_EVENT, event: { ...DM_EVENT.event, bot_id: 'B999' } };
        const raw = JSON.stringify(body);
        const res = makeRes();
        await capturedHandler(makeReq(raw, body), res);

        expect(res.statusCode).toBe(200);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('DM이 아닌 채널 메시지는 무시한다', async () => {
        const body = { ...DM_EVENT, event: { ...DM_EVENT.event, channel_type: 'channel' } };
        const raw = JSON.stringify(body);
        const res = makeRes();
        await capturedHandler(makeReq(raw, body), res);

        expect(res.statusCode).toBe(200);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('버튼 클릭(interactivity)은 action task를 만든다', async () => {
        const payload = {
            type: 'block_actions',
            trigger_id: 'trig123',
            team: { id: 'T123' },
            user: { id: 'U123' },
            channel: { id: 'D123' },
            response_url: 'https://hooks.slack.com/actions/xxx',
            actions: [{ action_id: 'confirm_reservation', value: 'conf-1' }],
        };
        const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
        const res = makeRes();
        await capturedHandler(makeReq(raw, { payload: JSON.stringify(payload) }), res);

        expect(res.statusCode).toBe(200);
        expect(mockDoc).toHaveBeenCalledWith('action_trig123');
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'action',
            actionId: 'confirm_reservation',
            confirmationId: 'conf-1',
            responseUrl: 'https://hooks.slack.com/actions/xxx',
        }));
    });

    it.each(['confirm_cancel', 'confirm_modify', 'cancel_reservation'])(
        '%s 버튼도 action task를 만든다 (수신 화이트리스트 회귀 방지)',
        async (actionId) => {
            const payload = {
                type: 'block_actions',
                trigger_id: `trig-${actionId}`,
                team: { id: 'T123' },
                user: { id: 'U123' },
                channel: { id: 'D123' },
                response_url: 'https://hooks.slack.com/actions/xxx',
                actions: [{ action_id: actionId, value: 'conf-9' }],
            };
            const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
            const res = makeRes();
            await capturedHandler(makeReq(raw, { payload: JSON.stringify(payload) }), res);

            expect(res.statusCode).toBe(200);
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'action',
                actionId,
                confirmationId: 'conf-9',
            }));
        },
    );

    it('화이트리스트에 없는 action_id는 task를 만들지 않는다', async () => {
        const payload = {
            type: 'block_actions',
            trigger_id: 'trig-unknown',
            team: { id: 'T123' },
            user: { id: 'U123' },
            channel: { id: 'D123' },
            actions: [{ action_id: 'some_other_button', value: 'x' }],
        };
        const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
        const res = makeRes();
        await capturedHandler(makeReq(raw, { payload: JSON.stringify(payload) }), res);

        expect(res.statusCode).toBe(200);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('POST가 아니면 405를 반환한다', async () => {
        const res = makeRes();
        await capturedHandler(makeReq('{}', {}, { method: 'GET' }), res);

        expect(res.statusCode).toBe(405);
    });
});
