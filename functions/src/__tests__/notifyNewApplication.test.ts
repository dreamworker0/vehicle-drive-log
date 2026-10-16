/**
 * notifyNewApplication.test.ts
 * - 기관 신청 문서의 상태 변화(신규 신청·거절·승인)에 따라 Discord·이메일 알림을 보낸다
 *
 * 2026-10-16 — 종전 파일은 상태 판정 로직을 이 파일 안에 **다시 구현해** 그 사본을 검사했다.
 * 원본 트리거를 한 줄도 실행하지 않아 커버리지 0%였다(Phase 181~211의 "사본을 검사하던 테스트"와
 * 같은 모양). 트리거 핸들러를 직접 부르도록 바꿨다. 판정 케이스는 그대로 옮겼다.
 */

const mockSendDiscordAlert = jest.fn().mockResolvedValue(undefined);
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock-id' });
const mockIsGmailConfigured = jest.fn(() => true);

jest.mock('../core/discord', () => ({ sendDiscordAlert: (...args: unknown[]) => mockSendDiscordAlert(...args) }));
jest.mock('../core/mailer', () => ({
    isGmailConfigured: () => mockIsGmailConfigured(),
    createGmailTransporter: () => ({ sendMail: mockSendMail }),
    systemMailFrom: () => '"차량운행일지" <noreply@example.com>',
}));
jest.mock('../core/params', () => ({ GMAIL_APP_PASSWORD: {} }));
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), flushSentry: jest.fn() }));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

import { notifyNewApplication } from '../handlers/triggers/notifyNewApplication';

type Doc = Record<string, unknown> | null;
const run = (before: Doc, after: Doc) =>
    (notifyNewApplication as unknown as (e: unknown) => Promise<void>)({
        params: { orgId: 'org1' },
        data: {
            before: { data: () => before ?? undefined },
            after: { data: () => after ?? undefined },
        },
    });

const applicant = { name: '행복복지관', applicantName: '홍길동', applicantEmail: 'a@b.c', applicantPhone: '010-0000-0000' };
const discordTitle = () => mockSendDiscordAlert.mock.calls[0]?.[0].title as string | undefined;

describe('notifyNewApplication', () => {
    const env = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGmailConfigured.mockReturnValue(true);
        process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@example.com';
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = { ...env };
        jest.restoreAllMocks();
    });

    describe('상태 변화 판정', () => {
        it.each([
            ['새 문서가 pending', null, 'pending', '새 기관 신청'],
            ['rejected → pending(재신청)', 'rejected', 'pending', '새 기관 신청'],
            ['pending → rejected', 'pending', 'rejected', '보류'],
            ['pending → approved', 'pending', 'approved', '승인 완료'],
        ])('%s', async (_label, beforeStatus, afterStatus, titlePart) => {
            await run(beforeStatus ? { ...applicant, status: beforeStatus } : null, { ...applicant, status: afterStatus });
            expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
            expect(discordTitle()).toContain(titlePart);
        });

        it.each([
            ['상태 변화 없음(pending 유지)', 'pending', 'pending'],
            ['상태 변화 없음(approved 유지 — 기관 정보 수정)', 'approved', 'approved'],
            ['새 문서가 approved가 아님(초기 상태 없음)', null, undefined],
        ])('%s이면 알리지 않는다', async (_label, beforeStatus, afterStatus) => {
            await run(beforeStatus ? { ...applicant, status: beforeStatus } : null, { ...applicant, status: afterStatus });
            expect(mockSendDiscordAlert).not.toHaveBeenCalled();
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        it('문서가 지워지면 아무것도 하지 않는다', async () => {
            await run({ ...applicant, status: 'pending' }, null);
            expect(mockSendDiscordAlert).not.toHaveBeenCalled();
        });
    });

    describe('신규 신청', () => {
        it('Discord에 연락처와 함께 알리고 운영 메일로 보낸다', async () => {
            await run(null, { ...applicant, status: 'pending', createdAt: { seconds: 1_760_000_000 } });

            expect(mockSendDiscordAlert.mock.calls[0][0].fields).toEqual([
                { name: '신청자 연락처', value: '010-0000-0000', inline: true },
                { name: '기관 이메일', value: 'a@b.c', inline: true },
            ]);
            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
                to: 'ops@example.com',
                subject: '[차량운행일지] 새 기관 신청: 행복복지관',
            }));
        });

        it('운영 메일 수신자가 없으면 발신 계정으로 받는다', async () => {
            delete process.env.ADMIN_NOTIFICATION_EMAIL;
            process.env.GMAIL_USER = 'sender@example.com';
            await run(null, { ...applicant, status: 'pending' });
            expect(mockSendMail.mock.calls[0][0].to).toBe('sender@example.com');
        });

        it('메일 본문의 신청 정보는 HTML로 해석되지 않게 이스케이프한다', async () => {
            await run(null, { ...applicant, name: '<b>기관</b>', applicantName: '<script>x</script>', status: 'pending' });
            const { html } = mockSendMail.mock.calls[0][0];
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;b&gt;기관&lt;/b&gt;');
        });

        it('빈 신청 정보는 대체 문구로 채운다', async () => {
            await run(null, { status: 'pending' });
            expect(mockSendDiscordAlert.mock.calls[0][0].description).toContain('**이름 없음** (이름: 이름 없음)');
        });

        it('메일 설정이 없으면 Discord만 보낸다', async () => {
            mockIsGmailConfigured.mockReturnValue(false);
            await run(null, { ...applicant, status: 'pending' });
            expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
            expect(mockSendMail).not.toHaveBeenCalled();
        });

        it('Discord·메일 실패는 트리거를 실패시키지 않는다(재시도 폭주 방지)', async () => {
            mockSendDiscordAlert.mockRejectedValueOnce(new Error('webhook down'));
            mockSendMail.mockRejectedValueOnce(new Error('smtp down'));
            await expect(run(null, { ...applicant, status: 'pending' })).resolves.toBeUndefined();
        });
    });

    describe('거절', () => {
        it('AI 검증 사유를 담고, 없으면 수동 반려로 적는다', async () => {
            await run({ ...applicant, status: 'pending' }, { ...applicant, status: 'rejected', aiVerifyDetail: { reason: '고유번호 불일치' } });
            expect(mockSendDiscordAlert.mock.calls[0][0].description).toContain('**사유**: 고유번호 불일치');

            mockSendDiscordAlert.mockClear();
            await run({ ...applicant, status: 'pending' }, { ...applicant, status: 'rejected' });
            expect(mockSendDiscordAlert.mock.calls[0][0].description).toContain('수동 반려');
            expect(mockSendMail).not.toHaveBeenCalled();
        });
    });
});
