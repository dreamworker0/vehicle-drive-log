/**
 * onSlackTaskCreated.test.ts — Slack 어시스턴트 워커 분기 로직
 * 외부 의존성(Slack API, 신원 매핑, 어시스턴트 코어, rate limit)은 모두 mock.
 */
// ── onDocumentCreated / HttpsError 캡처 Mock ──
let capturedHandler: any;
class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_options: any, handler: any) => {
        capturedHandler = handler;
    },
}));
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: MockHttpsError,
}));

// ── Firestore Mock (slackConfirmations 전용) ──
const mockConfAdd = jest.fn().mockResolvedValue({ id: 'conf-1' });
const mockConfGet = jest.fn();
const mockConfUpdate = jest.fn().mockResolvedValue(undefined);
const mockConfDoc = jest.fn(() => ({ get: mockConfGet, update: mockConfUpdate }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({ add: mockConfAdd, doc: mockConfDoc })),
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'mock-timestamp') },
}));

// ── 시크릿·Slack API·신원·코어·rate limit Mock ──
jest.mock('../core/params', () => ({
    SLACK_BOT_TOKEN: { value: () => 'xoxb-test' },
    SLACK_SIGNING_SECRET: { value: () => 'secret' },
}));
const mockPostMessage = jest.fn().mockResolvedValue(true);
const mockRespondToUrl = jest.fn().mockResolvedValue(undefined);
const mockAddReaction = jest.fn().mockResolvedValue(true);
jest.mock('../services/slack/slackApi', () => ({
    postMessage: (...args: unknown[]) => mockPostMessage(...args),
    respondToUrl: (...args: unknown[]) => mockRespondToUrl(...args),
    addReaction: (...args: unknown[]) => mockAddReaction(...args),
}));
const mockGetIntegration = jest.fn();
const mockResolveUser = jest.fn();
jest.mock('../services/slack/resolveSlackUser', () => ({
    getSlackIntegration: (...args: unknown[]) => mockGetIntegration(...args),
    resolveSlackUser: (...args: unknown[]) => mockResolveUser(...args),
}));
const mockHandleMessage = jest.fn();
const mockExecuteProposal = jest.fn();
jest.mock('../services/assistant/handleAssistantMessage', () => ({
    handleAssistantMessage: (...args: unknown[]) => mockHandleMessage(...args),
    executeReservationProposal: (...args: unknown[]) => mockExecuteProposal(...args),
}));
const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
jest.mock('../utils/constants', () => ({
    getRateLimits: jest.fn().mockResolvedValue({ max: 10, windowSec: 600 }),
}));

require('../handlers/triggers/onSlackTaskCreated');

// ── 이벤트 헬퍼 ──
const mockTaskUpdate = jest.fn().mockResolvedValue(undefined);
function makeEvent(task: Record<string, unknown>) {
    return {
        data: { data: () => task, ref: { update: mockTaskUpdate } },
        params: { taskId: 'task-1' },
    };
}

const MESSAGE_TASK = {
    kind: 'message', teamId: 'T123', slackUserId: 'U123', channel: 'D123', text: '오늘 예약 현황', messageTs: '1700000000.000100',
};
const ACTION_TASK = {
    kind: 'action', teamId: 'T123', slackUserId: 'U123', channel: 'D123',
    responseUrl: 'https://hooks.slack.com/actions/xxx',
    actionId: 'confirm_reservation', confirmationId: 'conf-1',
};
const RESOLVED_OK = { ok: true, uid: 'user1', orgId: 'org1', displayName: '홍길동' };

describe('onSlackTaskCreated', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        mockGetIntegration.mockResolvedValue({ organizationId: 'org1' });
        mockResolveUser.mockResolvedValue(RESOLVED_OK);
        mockConfAdd.mockResolvedValue({ id: 'conf-1' });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('연동되지 않은 워크스페이스면 안내 후 rejected 처리한다', async () => {
        mockGetIntegration.mockResolvedValue(null);

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test', 'D123', expect.stringContaining('연동되어 있지 않습니다'));
        expect(mockTaskUpdate).toHaveBeenCalledWith({ status: 'rejected', reason: 'no-integration' });
        expect(mockHandleMessage).not.toHaveBeenCalled();
    });

    it('rate limit 초과 시 사용자에게 안내하고 rate-limited 처리한다', async () => {
        mockCheckRateLimit.mockRejectedValueOnce(new MockHttpsError('resource-exhausted', '요청이 너무 많습니다. 10분 후 다시 시도해주세요.'));

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test', 'D123', expect.stringContaining('요청이 너무 많습니다'));
        expect(mockTaskUpdate).toHaveBeenCalledWith({ status: 'rate-limited' });
        expect(mockHandleMessage).not.toHaveBeenCalled();
    });

    it('신원 매핑 실패 시 안내 메시지를 보낸다', async () => {
        mockResolveUser.mockResolvedValue({ ok: false, message: '가입된 계정을 찾을 수 없습니다.' });

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test', 'D123', '가입된 계정을 찾을 수 없습니다.');
        expect(mockTaskUpdate).toHaveBeenCalledWith({ status: 'rejected', reason: 'identity' });
    });

    it('메시지 접수 시 이모지 리액션(eyes)을 단다', async () => {
        mockHandleMessage.mockResolvedValue({ replyText: '📅 오늘 예약 2건' });

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockAddReaction).toHaveBeenCalledWith('xoxb-test', 'D123', '1700000000.000100', 'eyes');
    });

    it('조회 응답(proposal 없음)은 그대로 DM으로 전송한다', async () => {
        mockHandleMessage.mockResolvedValue({ replyText: '📅 오늘 예약 2건' });

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockHandleMessage).toHaveBeenCalledWith('오늘 예약 현황', { uid: 'user1', orgId: 'org1', displayName: '홍길동' });
        expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test', 'D123', '📅 오늘 예약 2건');
        expect(mockConfAdd).not.toHaveBeenCalled();
        expect(mockTaskUpdate).toHaveBeenCalledWith({ status: 'done' });
    });

    it('예약 제안이면 확인 문서를 저장하고 버튼 블록을 전송한다', async () => {
        const proposal = { organizationId: 'org1', vehicleId: 'v1', date: '2026-07-19' };
        mockHandleMessage.mockResolvedValue({ replyText: '예약할까요?', proposal });

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockConfAdd).toHaveBeenCalledWith(expect.objectContaining({
            proposal,
            slackUserId: 'U123',
            teamId: 'T123',
            status: 'pending',
        }));
        const blocks = mockPostMessage.mock.calls[0][3];
        const actionBlock = blocks.find((b: { type: string }) => b.type === 'actions');
        expect(actionBlock.elements[0].value).toBe('conf-1');
        expect(actionBlock.elements[0].action_id).toBe('confirm_reservation');
    });

    it('확정 버튼이면 예약을 실행하고 원 메시지를 결과로 교체한다', async () => {
        const future = new Date(Date.now() + 60_000);
        mockConfGet.mockResolvedValue({
            exists: true,
            data: () => ({
                status: 'pending', slackUserId: 'U123', teamId: 'T123',
                proposal: { vehicleId: 'v1' },
                expiresAt: { toDate: () => future },
            }),
        });
        mockExecuteProposal.mockResolvedValue('✅ 예약이 확정되었습니다.');

        await capturedHandler(makeEvent(ACTION_TASK));

        expect(mockExecuteProposal).toHaveBeenCalledWith({ vehicleId: 'v1' }, 'slack');
        expect(mockRespondToUrl).toHaveBeenCalledWith(ACTION_TASK.responseUrl, {
            text: '✅ 예약이 확정되었습니다.',
            replace_original: true,
        });
        expect(mockConfUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'executing' }));
        expect(mockConfUpdate).toHaveBeenCalledWith({ status: 'executed' });
    });

    it('취소 버튼이면 예약을 실행하지 않고 취소 처리한다', async () => {
        const future = new Date(Date.now() + 60_000);
        mockConfGet.mockResolvedValue({
            exists: true,
            data: () => ({
                status: 'pending', slackUserId: 'U123', teamId: 'T123',
                proposal: {}, expiresAt: { toDate: () => future },
            }),
        });

        await capturedHandler(makeEvent({ ...ACTION_TASK, actionId: 'cancel_reservation' }));

        expect(mockExecuteProposal).not.toHaveBeenCalled();
        expect(mockRespondToUrl).toHaveBeenCalledWith(ACTION_TASK.responseUrl, expect.objectContaining({
            text: expect.stringContaining('취소했습니다'),
        }));
    });

    it('다른 사용자의 버튼 클릭은 거부한다', async () => {
        const future = new Date(Date.now() + 60_000);
        mockConfGet.mockResolvedValue({
            exists: true,
            data: () => ({
                status: 'pending', slackUserId: 'U-OTHER', teamId: 'T123',
                proposal: {}, expiresAt: { toDate: () => future },
            }),
        });

        await capturedHandler(makeEvent(ACTION_TASK));

        expect(mockExecuteProposal).not.toHaveBeenCalled();
        expect(mockRespondToUrl).toHaveBeenCalledWith(ACTION_TASK.responseUrl, expect.objectContaining({
            text: expect.stringContaining('본인이 요청한'),
        }));
    });

    it('만료된 확인 문서는 실행하지 않는다', async () => {
        const past = new Date(Date.now() - 60_000);
        mockConfGet.mockResolvedValue({
            exists: true,
            data: () => ({
                status: 'pending', slackUserId: 'U123', teamId: 'T123',
                proposal: {}, expiresAt: { toDate: () => past },
            }),
        });

        await capturedHandler(makeEvent(ACTION_TASK));

        expect(mockExecuteProposal).not.toHaveBeenCalled();
        expect(mockRespondToUrl).toHaveBeenCalledWith(ACTION_TASK.responseUrl, expect.objectContaining({
            text: expect.stringContaining('만료'),
        }));
    });

    it('처리 중 예외가 나면 사용자 안내 + failed 기록한다', async () => {
        mockHandleMessage.mockRejectedValue(new Error('Gemini 폭발'));

        await capturedHandler(makeEvent(MESSAGE_TASK));

        expect(mockPostMessage).toHaveBeenCalledWith('xoxb-test', 'D123', expect.stringContaining('오류가 발생했습니다'));
        expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
});
