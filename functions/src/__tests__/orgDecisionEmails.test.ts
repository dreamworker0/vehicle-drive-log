/**
 * orgDecisionEmails.test.ts — 기관 신청 승인·반려 메일(sendApprovalEmail·sendRejectionEmail)
 * - 지키는 것: superAdmin만, 발송 전 상한, 필수값, 메일 설정 없으면 내부 오류(조용히 성공하지 않음),
 *   본문의 기관명·이름·초대 코드·사유 HTML 이스케이프, 발송 실패는 원인 없이 internal,
 *   로그의 수신 주소는 마스킹
 */

const mockSendMail = jest.fn().mockResolvedValue(undefined);
const mockIsGmailConfigured = jest.fn(() => true);
const mockCheckRateLimitByUid = jest.fn().mockResolvedValue(undefined);

jest.mock('../core/mailer', () => ({
    isGmailConfigured: () => mockIsGmailConfigured(),
    createGmailTransporter: () => ({ sendMail: mockSendMail }),
    systemMailFrom: () => '"차량운행일지" <noreply@example.com>',
}));
jest.mock('../core/params', () => ({ GMAIL_APP_PASSWORD: {} }));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimitByUid(...args),
}));
// requireSuperAdmin·escapeHtml·maskEmail은 실제 코드를 쓴다
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

import { sendApprovalEmail } from '../handlers/callable/sendApprovalEmail';
import { sendRejectionEmail } from '../handlers/callable/sendRejectionEmail';

type Handler = (req: Record<string, unknown>) => Promise<unknown>;
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const approval = sendApprovalEmail as unknown as Handler;
const rejection = sendRejectionEmail as unknown as Handler;
const approvalData = { recipientEmail: 'head@welfare.or.kr', orgName: '행복복지관', inviteCode: 'AB12CD', applicantName: '홍길동' };
const rejectionData = { recipientEmail: 'head@welfare.or.kr', orgName: '행복복지관', applicantName: '홍길동', reason: '고유번호증 확인 불가' };

describe.each([
    ['sendApprovalEmail', approval, approvalData],
    ['sendRejectionEmail', rejection, rejectionData],
])('%s — 공통', (name, handler, data) => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGmailConfigured.mockReturnValue(true);
        mockCheckRateLimitByUid.mockResolvedValue(undefined);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('superAdmin이 아니면 상한도 쓰지 않고 거부한다', async () => {
        await expect(handler({ auth: null, data })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(handler({ auth: { uid: 'a1', token: { role: 'admin' } }, data })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCheckRateLimitByUid).not.toHaveBeenCalled();
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('호출자 uid로 시간당 10회 상한을 건다', async () => {
        await handler({ auth: superAdmin, data });
        expect(mockCheckRateLimitByUid).toHaveBeenCalledWith(name, 'sa1', 10, 3600);
    });

    it('상한에 걸리면 보내지 않는다', async () => {
        const err = Object.assign(new Error('too many'), { code: 'resource-exhausted' });
        mockCheckRateLimitByUid.mockRejectedValueOnce(err);
        await expect(handler({ auth: superAdmin, data })).rejects.toBe(err);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it.each(['recipientEmail', 'orgName'])('%s가 없으면 거부한다', async (field) => {
        await expect(handler({ auth: superAdmin, data: { ...data, [field]: '' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('메일 설정이 없으면 성공으로 넘기지 않고 내부 오류를 낸다', async () => {
        mockIsGmailConfigured.mockReturnValue(false);
        await expect(handler({ auth: superAdmin, data })).rejects.toMatchObject({ code: 'internal' });
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('발송 실패는 원인 없이 internal로 알린다', async () => {
        mockSendMail.mockRejectedValueOnce(new Error('Invalid login: 535 secret-detail'));
        await expect(handler({ auth: superAdmin, data })).rejects.toMatchObject({
            code: 'internal', message: expect.not.stringContaining('secret'),
        });
    });

    it('로그에는 수신 주소를 가려서 남긴다', async () => {
        await handler({ auth: superAdmin, data });
        const logged = (console.log as jest.Mock).mock.calls.flat().join(' ');
        expect(logged).not.toContain('head@welfare.or.kr');
    });

    it('기관명·이름은 HTML로 해석되지 않게 이스케이프한다', async () => {
        await handler({ auth: superAdmin, data: { ...data, orgName: '<b>기관</b>', applicantName: '<img src=x onerror=1>' } });
        const { html } = mockSendMail.mock.calls[0][0];
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<b>기관</b>');
        expect(html).toContain('&lt;b&gt;기관&lt;/b&gt;');
    });

    it('신청자 이름이 없으면 기관명으로 부른다', async () => {
        await handler({ auth: superAdmin, data: { ...data, applicantName: undefined } });
        expect(mockSendMail.mock.calls[0][0].html).toContain('안녕하세요, <strong>행복복지관</strong>님');
    });
});

describe('sendApprovalEmail — 승인', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGmailConfigured.mockReturnValue(true);
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('초대 코드가 없으면 거부한다 — 승인 메일의 핵심 내용이다', async () => {
        await expect(approval({ auth: superAdmin, data: { ...approvalData, inviteCode: '' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('신청자에게 초대 코드와 코드가 담긴 서비스 링크를 보낸다', async () => {
        await expect(approval({ auth: superAdmin, data: approvalData })).resolves.toEqual({ success: true });
        const { to, subject, html } = mockSendMail.mock.calls[0][0];
        expect(to).toBe('head@welfare.or.kr');
        expect(subject).toBe('[차량운행일지] 행복복지관 기관 승인 완료');
        expect(html).toContain('AB12CD');
        expect(html).toContain('href="https://drivelog.socialprism.co.kr?code=AB12CD"');
    });

    it('초대 코드는 링크에서 인코딩되고 본문에서 이스케이프된다', async () => {
        await approval({ auth: superAdmin, data: { ...approvalData, inviteCode: 'A&B"<' } });
        const { html } = mockSendMail.mock.calls[0][0];
        expect(html).toContain('?code=A%26B%22%3C');
        expect(html).not.toContain('A&B"<');
    });
});

describe('sendRejectionEmail — 반려', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGmailConfigured.mockReturnValue(true);
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('반려 사유를 담아 보낸다(사유도 이스케이프)', async () => {
        await expect(rejection({ auth: superAdmin, data: { ...rejectionData, reason: '<script>x</script> 서류 불명확' } }))
            .resolves.toEqual({ success: true });
        const { subject, html } = mockSendMail.mock.calls[0][0];
        expect(subject).toBe('[차량운행일지] 행복복지관 기관 신청 반려 안내');
        expect(html).toContain('거절 사유');
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt; 서류 불명확');
    });

    it('사유가 없으면 사유 칸을 넣지 않는다', async () => {
        await rejection({ auth: superAdmin, data: { ...rejectionData, reason: undefined } });
        expect(mockSendMail.mock.calls[0][0].html).not.toContain('거절 사유');
    });
});
