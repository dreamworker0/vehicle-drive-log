// ── Mock 설정 ──
const mockSendPushToUser = jest.fn().mockResolvedValue(undefined);
const mockCreateInAppNotification = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/alimtalk/sendNotification', () => ({
    sendPushToUser: mockSendPushToUser,
    createInAppNotification: mockCreateInAppNotification,
}));

const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDocRef = { update: mockUpdate };
const mockDoc = jest.fn(() => mockDocRef);
const mockWhere = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockGet = jest.fn();

const mockCollectionRef = {
    doc: mockDoc,
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
};
const mockCollection = jest.fn(() => mockCollectionRef);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: jest.fn() },
}));

import { checkReservationReminders } from "../services/alimtalk/reservationReminder";

describe('checkReservationReminders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // jest.spyOn(console, 'log').mockImplementation();
        // jest.spyOn(console, 'error').mockImplementation();
        // 2026-03-04 10:00 KST (= 01:00 UTC)
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-04T01:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('예약이 없으면 알림을 보내지 않는다', async () => {
        const emptySnap = { docs: [] };
        mockGet
            .mockResolvedValueOnce(emptySnap)
            .mockResolvedValueOnce(emptySnap)
            .mockResolvedValueOnce(emptySnap);

        await checkReservationReminders();

        expect(mockSendPushToUser).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('10분 이내 예약에 임박 알림을 보낸다', async () => {
        const upcomingDoc = {
            id: 'res1',
            data: () => ({
                userId: 'user1',
                vehicleDisplayName: '소나타',
                startTime: '10:05',
                reminderSent: false,
                status: 'reserved',
            }),
        };

        mockGet
            .mockResolvedValueOnce({ docs: [upcomingDoc] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });

        await checkReservationReminders();

        expect(mockSendPushToUser).toHaveBeenCalledWith('user1', {
            title: '🚗 예약 임박',
            body: '소나타 예약이 10:05에 시작됩니다.',
        });
        expect(mockUpdate).toHaveBeenCalledWith({ reminderSent: true });
    });

    it('이미 알림을 보낸 예약은 스킵한다', async () => {
        const alreadySent = {
            id: 'res1',
            data: () => ({
                userId: 'user1',
                vehicleDisplayName: '소나타',
                startTime: '10:05',
                reminderSent: true,
            }),
        };

        mockGet
            .mockResolvedValueOnce({ docs: [alreadySent] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });

        await checkReservationReminders();

        expect(mockSendPushToUser).not.toHaveBeenCalled();
    });

    it('종료 후 운행일지가 없으면 미작성 알림을 보낸다', async () => {
        const completedDoc = {
            id: 'res2',
            data: () => ({
                userId: 'user2',
                vehicleDisplayName: '아이오닉5',
                endTime: '09:30',
                driveLogReminderSent: false,
                status: 'completed',
            }),
        };

        mockGet
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [completedDoc] })
            .mockResolvedValueOnce({ docs: [], empty: true })
            .mockResolvedValueOnce({ docs: [] });

        await checkReservationReminders();

        expect(mockSendPushToUser).toHaveBeenCalledWith('user2', {
            title: '📝 운행일지 작성 알림',
            body: '아이오닉5 운행이 종료되었습니다. 운행일지를 작성해주세요.',
        });
        expect(mockUpdate).toHaveBeenCalledWith({ driveLogReminderSent: true });
    });

    it('미출발(No-show) 예약에 알림을 보낸다', async () => {
        const noShowDoc = {
            id: 'res3',
            data: () => ({
                userId: 'user3',
                vehicleDisplayName: '카니발',
                startTime: '09:40',
                noShowReminderSent: false,
                status: 'reserved',
            }),
        };

        mockGet
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [noShowDoc] });

        await checkReservationReminders();

        expect(mockSendPushToUser).toHaveBeenCalledWith(
            'user3',
            expect.objectContaining({
                title: '🚨 예약 시작시간이 지났습니다',
            }),
            expect.objectContaining({
                reservationId: 'res3',
                action: 'cancel_prompt',
            })
        );
        expect(mockUpdate).toHaveBeenCalledWith({ noShowReminderSent: true });
    });
});
