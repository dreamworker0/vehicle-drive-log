// ── Mock 설정 ──
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDocGet = jest.fn();
const mockDocRef = { get: mockDocGet, update: mockUpdate, id: 'auto-id' };
const mockDoc = jest.fn(() => mockDocRef);
const mockAdd = jest.fn().mockResolvedValue({ id: 'newId' });
const mockWhere = jest.fn().mockReturnThis();
const mockQueryGet = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

const mockCollectionRef = {
    doc: mockDoc,
    add: mockAdd,
    where: mockWhere,
    get: mockQueryGet,
};
const mockCollection = jest.fn(() => mockCollectionRef);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: mockCollection,
        batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
    }),
    FieldValue: {
        serverTimestamp: () => 'mock-timestamp',
    },
}));

const mockSend = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
    getMessaging: () => ({ send: mockSend }),
}));

import {
    sendPushToUser,
    sendPushToOrg,
    createInAppNotification,
    createInAppNotificationForOrg,
} from "../services/alimtalk/sendNotification";

describe('sendNotification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ── sendPushToUser ──
    describe('sendPushToUser()', () => {
        it('FCM 토큰이 있는 사용자에게 푸시를 전송한다', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: 'valid-token' }),
            });
            mockSend.mockResolvedValue('msg-id');

            await sendPushToUser('user1', { title: '테스트', body: '알림' });

            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    token: 'valid-token',
                    notification: { title: '테스트', body: '알림' },
                })
            );
        });

        it('사용자가 존재하지 않으면 전송하지 않는다', async () => {
            mockDocGet.mockResolvedValue({ exists: false });

            await sendPushToUser('ghost', { title: '테스트', body: '알림' });

            expect(mockSend).not.toHaveBeenCalled();
        });

        it('FCM 토큰이 없으면 전송하지 않는다', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: null }),
            });

            await sendPushToUser('user1', { title: '테스트', body: '알림' });

            expect(mockSend).not.toHaveBeenCalled();
        });

        it('만료된 토큰이면 Firestore에서 토큰을 삭제한다', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: 'expired-token' }),
            });
            mockSend.mockRejectedValue({
                code: 'messaging/registration-token-not-registered',
            });

            await sendPushToUser('user1', { title: '테스트', body: '알림' });

            expect(mockUpdate).toHaveBeenCalledWith({ fcmToken: null });
        });

        it('data.link가 있으면 커스텀 URL을 사용한다', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: 'token' }),
            });
            mockSend.mockResolvedValue('msg-id');

            await sendPushToUser(
                'user1',
                { title: '테스트', body: '알림' },
                { link: 'https://example.com/custom' }
            );

            const sendArg = mockSend.mock.calls[0][0];
            expect(sendArg.data.click_action).toBe('https://example.com/custom');
            expect(sendArg.webpush.fcmOptions.link).toBe('https://example.com/custom');
        });
    });

    // ── sendPushToOrg ──
    describe('sendPushToOrg()', () => {
        it('기관 멤버 전원에게 알림을 전송한다', async () => {
            const mockMembers = [
                { id: 'user1' },
                { id: 'user2' },
                { id: 'user3' },
            ];
            mockQueryGet.mockResolvedValue({
                forEach: (cb: (doc: { id: string }) => void) => mockMembers.forEach(cb),
            });
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: 'token' }),
            });
            mockSend.mockResolvedValue('ok');

            await sendPushToOrg('org1', { title: '공지', body: '내용' });

            expect(mockSend).toHaveBeenCalledTimes(3);
        });

        it('excludeUid로 지정된 사용자는 제외한다', async () => {
            const mockMembers = [
                { id: 'user1' },
                { id: 'sender' },
            ];
            mockQueryGet.mockResolvedValue({
                forEach: (cb: (doc: { id: string }) => void) => mockMembers.forEach(cb),
            });
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ fcmToken: 'token' }),
            });
            mockSend.mockResolvedValue('ok');

            await sendPushToOrg('org1', { title: '공지', body: '내용' }, 'sender');

            expect(mockSend).toHaveBeenCalledTimes(1);
        });
    });

    // ── createInAppNotification ──
    describe('createInAppNotification()', () => {
        it('Firestore에 알림 문서를 생성한다', async () => {
            await createInAppNotification('user1', 'info', '제목', '내용', 'org1');

            expect(mockAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    targetUid: 'user1',
                    type: 'info',
                    title: '제목',
                    message: '내용',
                    organizationId: 'org1',
                    read: false,
                })
            );
        });

        it('organizationId가 없으면 빈 문자열로 저장한다', async () => {
            await createInAppNotification('user1', 'info', '제목', '내용');

            const callArg = mockAdd.mock.calls[0][0];
            expect(callArg.organizationId).toBe('');
        });
    });

    // ── createInAppNotificationForOrg ──
    describe('createInAppNotificationForOrg()', () => {
        it('기관 전체 멤버에게 batch로 알림을 생성한다', async () => {
            const mockMembers = [
                { id: 'user1' },
                { id: 'user2' },
            ];
            mockQueryGet.mockResolvedValue({
                forEach: (cb: (doc: { id: string }) => void) => mockMembers.forEach(cb),
            });

            await createInAppNotificationForOrg('org1', 'admin_notice', '공지', '내용');

            expect(mockBatchSet).toHaveBeenCalledTimes(2);
            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
        });

        it('excludeUid를 제외하고 batch를 생성한다', async () => {
            const mockMembers = [
                { id: 'user1' },
                { id: 'excluded' },
                { id: 'user3' },
            ];
            mockQueryGet.mockResolvedValue({
                forEach: (cb: (doc: { id: string }) => void) => mockMembers.forEach(cb),
            });

            await createInAppNotificationForOrg('org1', 'info', '제목', '내용', 'excluded');

            expect(mockBatchSet).toHaveBeenCalledTimes(2); // user1, user3만
        });
    });
});
