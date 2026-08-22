// ── Mock 설정 ──
const mockSendPushToUser = jest.fn().mockResolvedValue(undefined);
const mockCreateInAppNotification = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/alimtalk/sendNotification', () => ({
    sendPushToUser: mockSendPushToUser,
    createInAppNotification: mockCreateInAppNotification,
}));

const mockResolveOrgSlackBotToken = jest.fn().mockResolvedValue(null);
const mockSendSlackDMToUser = jest.fn().mockResolvedValue(true);
jest.mock('../services/slack/notifySlackUser', () => ({
    resolveOrgSlackBotToken: mockResolveOrgSlackBotToken,
    sendSlackDMToUser: mockSendSlackDMToUser,
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

    it('Slack 연동 기관 예약은 FCM과 함께 Slack DM도 보낸다', async () => {
        mockResolveOrgSlackBotToken.mockResolvedValueOnce('xoxb-token');
        const upcomingDoc = {
            id: 'res1',
            data: () => ({
                reservedByUid: 'user1',
                organizationId: 'org1',
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

        expect(mockResolveOrgSlackBotToken).toHaveBeenCalledWith('org1');
        expect(mockSendSlackDMToUser).toHaveBeenCalledWith(
            'xoxb-token',
            'user1',
            '🚗 소나타 예약이 10:05에 시작됩니다.'
        );
        // Slack을 보내도 기존 FCM/중복방지 플래그는 그대로
        expect(mockSendPushToUser).toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalledWith({ reminderSent: true });
    });

    it('같은 기관 예약이 여러 건이면 봇 토큰 조회를 1회로 캐시한다', async () => {
        mockResolveOrgSlackBotToken.mockResolvedValueOnce('xoxb-token');
        const mk = (id: string, uid: string) => ({
            id,
            data: () => ({
                reservedByUid: uid,
                organizationId: 'org1',
                vehicleDisplayName: '소나타',
                startTime: '10:05',
                reminderSent: false,
                status: 'reserved',
            }),
        });

        mockGet
            .mockResolvedValueOnce({ docs: [mk('res1', 'u1'), mk('res2', 'u2')] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });

        await checkReservationReminders();

        // 같은 org라 봇 토큰 조회는 1회, DM은 예약 건수(2회)만큼
        expect(mockResolveOrgSlackBotToken).toHaveBeenCalledTimes(1);
        expect(mockSendSlackDMToUser).toHaveBeenCalledTimes(2);
    });

    it('미연동 기관 예약은 Slack DM을 보내지 않는다 (FCM은 정상)', async () => {
        mockResolveOrgSlackBotToken.mockResolvedValueOnce(null);
        const upcomingDoc = {
            id: 'res1',
            data: () => ({
                reservedByUid: 'user1',
                organizationId: 'org-no-slack',
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

        expect(mockSendSlackDMToUser).not.toHaveBeenCalled();
        expect(mockSendPushToUser).toHaveBeenCalled();
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
    // ── 운행일지 존재 확인 배치화 ──
    // 예전에는 후보마다 driveLogs 쿼리를 따로 던졌다. Firestore는 결과가 없는 쿼리에도
    // 읽기 1건을 최소 과금하므로, 일지를 안 쓴 후보가 많을수록(= 알림 대상이 많을수록)
    // 후보 수만큼 읽기가 청구됐다. 아래 세 건이 "묶어서 한 번"을 고정한다.

    function completedRes(id: string, user: string, vehicle: string) {
        return {
            id,
            data: () => ({
                userId: user,
                vehicleDisplayName: vehicle,
                endTime: '09:30',
                driveLogReminderSent: false,
                status: 'completed',
            }),
        };
    }

    it('후보가 여러 건이어도 driveLogs 조회는 한 번이다', async () => {
        const candidates = [
            completedRes('resA', 'userA', '스타렉스'),
            completedRes('resB', 'userB', '카니발'),
            completedRes('resC', 'userC', '아이오닉5'),
        ];

        mockGet
            .mockResolvedValueOnce({ docs: [] })            // 1) 임박 알림
            .mockResolvedValueOnce({ docs: candidates })    // 2) 종료 예약
            .mockResolvedValueOnce({ docs: [] })            // 3) driveLogs 배치 — 아무도 안 씀
            .mockResolvedValueOnce({ docs: [] });           // 4) no-show

        await checkReservationReminders();

        // driveLogs 쿼리가 후보 수(3)만큼이 아니라 1회만 나갔다 → 전체 get 호출은 4회
        expect(mockGet).toHaveBeenCalledTimes(4);
        // in 절에 후보 id가 한 번에 실렸다
        expect(mockWhere).toHaveBeenCalledWith('reservationId', 'in', ['resA', 'resB', 'resC']);
        // 세 명 모두에게 알림
        expect(mockSendPushToUser).toHaveBeenCalledTimes(3);
        expect(mockUpdate).toHaveBeenCalledTimes(3);
    });

    it('이미 일지를 쓴 예약만 골라 건너뛴다', async () => {
        const candidates = [
            completedRes('resA', 'userA', '스타렉스'),
            completedRes('resB', 'userB', '카니발'),
        ];
        // resB는 이미 작성됨 — 배치 결과로 판별한다
        const logs = [{ id: 'log1', data: () => ({ reservationId: 'resB' }) }];

        mockGet
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: candidates })
            .mockResolvedValueOnce({ docs: logs })
            .mockResolvedValueOnce({ docs: [] });

        await checkReservationReminders();

        expect(mockSendPushToUser).toHaveBeenCalledTimes(1);
        expect(mockSendPushToUser).toHaveBeenCalledWith('userA', {
            title: '📝 운행일지 작성 알림',
            body: '스타렉스 운행이 종료되었습니다. 운행일지를 작성해주세요.',
        });
    });

    it('후보가 없으면 driveLogs를 아예 조회하지 않는다', async () => {
        // 종료 예약이 있어도 전부 이미 알림 발송(driveLogReminderSent)이면 조회할 이유가 없다
        const alreadySent = {
            id: 'resX',
            data: () => ({
                userId: 'userX',
                endTime: '09:30',
                driveLogReminderSent: true,
                status: 'completed',
            }),
        };

        mockGet
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [alreadySent] })
            .mockResolvedValueOnce({ docs: [] });  // no-show (driveLogs 조회 없음)

        await checkReservationReminders();

        expect(mockGet).toHaveBeenCalledTimes(3); // driveLogs 쿼리가 끼지 않았다
        expect(mockWhere).not.toHaveBeenCalledWith('reservationId', 'in', expect.anything());
        expect(mockSendPushToUser).not.toHaveBeenCalled();
    });
});
