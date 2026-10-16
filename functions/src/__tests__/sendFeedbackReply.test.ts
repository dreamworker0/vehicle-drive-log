/**
 * sendFeedbackReply.test.ts
 * - 시스템 관리자가 의견에 답변 — 저장 후 질문자에게 앱 알림·푸시·이메일
 * - 지키는 것: superAdmin만, 한 의견에 답변 한 번, 비회원 문의는 이메일만, 이메일 HTML 이스케이프,
 *   이메일 실패가 답변 저장을 되돌리지 않음
 */

const mockFeedbackGet = jest.fn();
const mockFeedbackUpdate = jest.fn().mockResolvedValue(undefined);
const mockSendPushToUser = jest.fn().mockResolvedValue(undefined);
const mockCreateInAppNotification = jest.fn().mockResolvedValue(undefined);
const mockSendMail = jest.fn().mockResolvedValue(undefined);
const mockIsGmailConfigured = jest.fn(() => true);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ get: mockFeedbackGet, update: mockFeedbackUpdate })),
        })),
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));
jest.mock('../services/alimtalk/sendNotification', () => ({
    sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
    createInAppNotification: (...args: unknown[]) => mockCreateInAppNotification(...args),
}));
jest.mock('../core/mailer', () => ({
    isGmailConfigured: () => mockIsGmailConfigured(),
    createGmailTransporter: () => ({ sendMail: mockSendMail }),
    systemMailFrom: () => '"차량운행일지" <noreply@example.com>',
}));
jest.mock('../core/params', () => ({ GMAIL_APP_PASSWORD: {} }));
// requireSuperAdmin·escapeHtml은 실제 코드를 쓴다 — 권한 판정과 이스케이프가 이 테스트의 대상이다
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), flushSentry: jest.fn() }));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
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

import { sendFeedbackReply } from '../handlers/callable/sendFeedbackReply';

const handler = sendFeedbackReply as unknown as (req: Record<string, unknown>) => Promise<unknown>;
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const call = (data: unknown, auth: unknown = superAdmin) => handler({ auth, data });
const feedback = (data: Record<string, unknown> | null) =>
    mockFeedbackGet.mockResolvedValueOnce({ exists: data !== null, data: () => data ?? undefined });

describe('sendFeedbackReply', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGmailConfigured.mockReturnValue(true);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    describe('권한·입력', () => {
        it('로그인하지 않으면 거부한다', async () => {
            await expect(call({ feedbackId: 'f1', replyText: '답' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        });

        it('기관 관리자도 거부한다 — 의견 답변은 시스템 관리자만', async () => {
            await expect(call({ feedbackId: 'f1', replyText: '답' }, { uid: 'a1', token: { role: 'admin' } }))
                .rejects.toMatchObject({ code: 'permission-denied' });
            expect(mockFeedbackGet).not.toHaveBeenCalled();
        });

        it.each([
            ['의견 ID 없음', { replyText: '답' }],
            ['답변 없음', { feedbackId: 'f1' }],
            ['공백뿐인 답변', { feedbackId: 'f1', replyText: '   ' }],
        ])('%s은 거부한다', async (_label, data) => {
            await expect(call(data)).rejects.toMatchObject({ code: 'invalid-argument' });
        });

        it('의견이 없으면 not-found', async () => {
            feedback(null);
            await expect(call({ feedbackId: 'f1', replyText: '답' })).rejects.toMatchObject({ code: 'not-found' });
        });

        it('이미 답변한 의견은 다시 보내지 않는다', async () => {
            feedback({ status: 'resolved', authorUid: 'u1' });
            await expect(call({ feedbackId: 'f1', replyText: '답' })).rejects.toMatchObject({ code: 'already-exists' });
            expect(mockFeedbackUpdate).not.toHaveBeenCalled();
            expect(mockSendPushToUser).not.toHaveBeenCalled();
        });
    });

    describe('발송', () => {
        it('답변을 다듬어 저장하고 질문자에게 푸시·앱 알림·이메일을 보낸다', async () => {
            feedback({ status: 'unread', authorUid: 'u1', organizationId: 'org1', userEmail: 'u1@example.com', userName: '홍길동' });
            await expect(call({ feedbackId: 'f1', replyText: '  반영했습니다.  ' })).resolves.toEqual({ success: true });

            expect(mockFeedbackUpdate).toHaveBeenCalledWith({
                reply: '반영했습니다.', repliedAt: 'SERVER_TIMESTAMP', repliedBy: 'superAdmin', status: 'resolved',
            });
            expect(mockSendPushToUser).toHaveBeenCalledWith('u1', { title: '의견에 답변이 도착했습니다', body: '반영했습니다.' });
            expect(mockCreateInAppNotification).toHaveBeenCalledWith('u1', 'feedback_reply', '의견에 답변이 도착했습니다', '반영했습니다.', 'org1');
            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u1@example.com' }));
        });

        it('푸시에는 80자 미리보기를, 앱 알림에는 전체 답변을 담는다', async () => {
            const long = '가'.repeat(100);
            feedback({ status: 'unread', authorUid: 'u1' });
            await call({ feedbackId: 'f1', replyText: long });

            expect(mockSendPushToUser.mock.calls[0][1].body).toBe(`${'가'.repeat(80)}...`);
            expect(mockCreateInAppNotification.mock.calls[0][3]).toBe(long);
        });

        it('비회원 문의(public-inquiry)는 앱 알림 없이 이메일만 보낸다', async () => {
            feedback({ status: 'unread', authorUid: 'public-inquiry', authorEmail: 'guest@example.com' });
            await call({ feedbackId: 'f1', replyText: '답변' });

            expect(mockSendPushToUser).not.toHaveBeenCalled();
            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'guest@example.com' }));
        });

        it('이메일 본문의 이름·답변은 HTML로 해석되지 않게 이스케이프한다', async () => {
            feedback({ status: 'unread', authorUid: 'u1', userEmail: 'u1@example.com', userName: '<img src=x onerror=alert(1)>' });
            await call({ feedbackId: 'f1', replyText: '<script>alert(1)</script>' });

            const { html } = mockSendMail.mock.calls[0][0];
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;script&gt;');
        });

        it('이메일 주소가 없으면 메일을 보내지 않는다', async () => {
            feedback({ status: 'unread', authorUid: 'u1' });
            await call({ feedbackId: 'f1', replyText: '답변' });
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        it('메일 설정이 없으면 메일만 건너뛴다', async () => {
            mockIsGmailConfigured.mockReturnValue(false);
            feedback({ status: 'unread', authorUid: 'u1', userEmail: 'u1@example.com' });
            await expect(call({ feedbackId: 'f1', replyText: '답변' })).resolves.toEqual({ success: true });
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        it('메일 발송이 실패해도 답변 저장·앱 알림은 성공으로 끝난다', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            mockSendMail.mockRejectedValueOnce(new Error('smtp down'));
            feedback({ status: 'unread', authorUid: 'u1', userEmail: 'u1@example.com' });

            await expect(call({ feedbackId: 'f1', replyText: '답변' })).resolves.toEqual({ success: true });
            expect(mockFeedbackUpdate).toHaveBeenCalled();
            expect(mockCreateInAppNotification).toHaveBeenCalled();
        });
    });
});
