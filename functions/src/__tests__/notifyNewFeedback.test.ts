/**
 * notifyNewFeedback.test.ts
 * - 의견 등록 시 Discord 알림을 보내고, AI 초안은 만들지 않는다(2026-10-16 운영자 요청)
 * - 작성자별·전역 일일 상한을 넘으면 알림을 생략한다(운영 채널 도배 방지)
 */

const mockSendDiscordAlert = jest.fn().mockResolvedValue(undefined);
const mockCheckRateLimitBySubject = jest.fn().mockResolvedValue(false);
const mockOrgGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => ({
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: mockOrgGet })) })),
    })),
}));
jest.mock('../core/discord', () => ({ sendDiscordAlert: (...args: unknown[]) => mockSendDiscordAlert(...args) }));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitBySubject: (...args: unknown[]) => mockCheckRateLimitBySubject(...args),
}));
jest.mock('../utils/helpers', () => ({ log: jest.fn() }));
// 트리거 래퍼를 벗겨 핸들러를 직접 부른다
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

import { notifyNewFeedback } from '../handlers/triggers/notifyNewFeedback';

type Handler = (event: unknown) => Promise<void>;
const run = (data: Record<string, unknown>) => {
    const update = jest.fn();
    const event = { data: { data: () => data, ref: { update } } };
    return (notifyNewFeedback as unknown as Handler)(event).then(() => ({ update }));
};

describe('notifyNewFeedback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCheckRateLimitBySubject.mockResolvedValue(false);
        mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ name: '행복복지관' }) });
    });

    it('작성자·기관·내용을 담아 알림을 보내고 문서는 건드리지 않는다(AI 초안 없음)', async () => {
        const { update } = await run({
            message: '일지 수정 후 목록으로 돌아오면 좋겠어요',
            userName: '홍길동', userEmail: 'a@b.c', organizationId: 'org1', authorUid: 'u1',
        });

        expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
        const { fields } = mockSendDiscordAlert.mock.calls[0][0];
        expect(fields).toEqual([
            { name: '작성자', value: '홍길동 (a@b.c)\n행복복지관', inline: true },
            { name: '분류', value: '일반', inline: true },
            { name: '내용', value: '일지 수정 후 목록으로 돌아오면 좋겠어요', inline: false },
        ]);
        expect(update).not.toHaveBeenCalled();
    });

    it('작성자별 한도를 넘으면 알림을 생략한다', async () => {
        mockCheckRateLimitBySubject.mockResolvedValueOnce(true);
        await run({ message: '도배', authorUid: 'u1' });

        expect(mockCheckRateLimitBySubject).toHaveBeenCalledWith('feedbackAlert', 'uid_u1', 20, 86400, 'closed');
        expect(mockSendDiscordAlert).not.toHaveBeenCalled();
    });

    it('전역 예산이 바닥나면 알림을 생략한다', async () => {
        mockCheckRateLimitBySubject.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await run({ message: '도배', authorUid: 'u2' });

        expect(mockCheckRateLimitBySubject).toHaveBeenLastCalledWith('feedbackAlertGlobal', '__global__', 200, 86400, 'closed');
        expect(mockSendDiscordAlert).not.toHaveBeenCalled();
    });

    it('빈 의견은 한도를 쓰지 않고 넘어간다', async () => {
        await run({ message: '   ', authorUid: 'u1' });
        expect(mockCheckRateLimitBySubject).not.toHaveBeenCalled();
        expect(mockSendDiscordAlert).not.toHaveBeenCalled();
    });

    it('기관명 조회가 실패해도 알림은 보낸다', async () => {
        mockOrgGet.mockRejectedValueOnce(new Error('unavailable'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        await run({ message: '문의', userName: '김', organizationId: 'org1', authorUid: 'u1' });

        expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
        expect(mockSendDiscordAlert.mock.calls[0][0].fields[0].value).toBe('김');
    });
});
