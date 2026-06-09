/**
 * reservationTriggers.test.ts — 예약 트리거 단위 테스트
 *
 * getVehicleCalendarId 및 각 트리거의 핵심 분기 로직을 검증한다.
 * Firebase 트리거 핸들러는 내부적으로 Firestore·Calendar·Push를 호출하므로
 * 모킹을 통해 호출 여부와 분기 조건만 검증한다.
 */

// ── 공유 mock ──
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection, doc: mockDoc }),
}));

const mockCreateCalendarEvent = jest.fn();
const mockUpdateCalendarEvent = jest.fn();
const mockDeleteCalendarEvent = jest.fn();
jest.mock('../services/calendar/calendarSync', () => ({
    createCalendarEvent: (...args: unknown[]) => mockCreateCalendarEvent(...args),
    updateCalendarEvent: (...args: unknown[]) => mockUpdateCalendarEvent(...args),
    deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
}));

const mockSendPushToOrg = jest.fn();
const mockSendPushToUser = jest.fn();
const mockCreateInAppNotification = jest.fn();
jest.mock('../services/alimtalk/sendNotification', () => ({
    sendPushToOrg: (...args: unknown[]) => mockSendPushToOrg(...args),
    sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
    createInAppNotification: (...args: unknown[]) => mockCreateInAppNotification(...args),
}));

// firebase-functions v2 트리거를 단순 래퍼로 mock
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_path: string, handler: Function) => handler,
    onDocumentUpdated: (_path: string, handler: Function) => handler,
    onDocumentDeleted: (_path: string, handler: Function) => handler,
}));

import { onReservationCreated, onReservationUpdated, onReservationDeleted } from "../handlers/triggers/reservationTriggers";

describe('reservationTriggers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    // ── 헬퍼 ──
    const makeCreateEvent = (data: Record<string, unknown>) => ({
        data: { data: () => data },
        params: { reservationId: 'res-1' },
    });

    const makeUpdateEvent = (before: Record<string, unknown>, after: Record<string, unknown>) => ({
        data: {
            before: { data: () => before },
            after: { data: () => after },
        },
        params: { reservationId: 'res-1' },
    });

    const makeDeleteEvent = (data: Record<string, unknown>) => ({
        data: { data: () => data },
        params: { reservationId: 'res-1' },
    });

    describe('onReservationCreated', () => {
        it('syncSource=calendar이면 캘린더 이벤트를 생성하지 않는다', async () => {
            const event = makeCreateEvent({ syncSource: 'calendar', vehicleId: 'v1' });
            await (onReservationCreated as Function)(event);
            expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
        });

        it('차량에 calendarId가 없으면 캘린더 이벤트를 건너뛴다', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
            const event = makeCreateEvent({ vehicleId: 'v1', organizationId: 'org1' });
            await (onReservationCreated as Function)(event);
            expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
        });

        it('정상 생성 시 캘린더 이벤트를 생성하고 eventId를 저장한다', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ googleCalendarId: 'cal@group.calendar.google.com' }) });
            mockCreateCalendarEvent.mockResolvedValue('event-123');
            mockUpdate.mockResolvedValue(undefined);
            mockSendPushToOrg.mockResolvedValue(undefined);

            const event = makeCreateEvent({ vehicleId: 'v1', organizationId: 'org1', reservedByName: '홍길동', date: '2026-01-01' });
            await (onReservationCreated as Function)(event);

            expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
            expect(mockUpdate).toHaveBeenCalledWith({ calendarEventId: 'event-123' });
        });

        it('organizationId가 있으면 조직 푸시 알림을 전송한다', async () => {
            mockGet.mockResolvedValue({ exists: false });
            mockSendPushToOrg.mockResolvedValue(undefined);

            const event = makeCreateEvent({ vehicleId: 'v1', organizationId: 'org1', reservedBy: 'user1' });
            await (onReservationCreated as Function)(event);

            expect(mockSendPushToOrg).toHaveBeenCalledWith(
                'org1',
                expect.objectContaining({ title: '새 차량 예약' }),
                'user1'
            );
        });
    });

    describe('onReservationUpdated', () => {
        it('calendar 역동기화 변경이면 캘린더 업데이트를 스킵한다', async () => {
            const event = makeUpdateEvent(
                { syncSource: undefined, status: 'confirmed' },
                { syncSource: 'calendar', status: 'confirmed', vehicleId: 'v1' }
            );
            await (onReservationUpdated as Function)(event);
            expect(mockUpdateCalendarEvent).not.toHaveBeenCalled();
        });

        it('calendarEventId만 추가된 경우 무한 루프를 방지한다', async () => {
            const event = makeUpdateEvent(
                { status: 'confirmed', vehicleId: 'v1' },
                { status: 'confirmed', vehicleId: 'v1', calendarEventId: 'ev1' }
            );
            await (onReservationUpdated as Function)(event);
            expect(mockUpdateCalendarEvent).not.toHaveBeenCalled();
        });

        it('취소 시 캘린더 이벤트를 삭제하고 인앱 알림을 전송한다', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ googleCalendarId: 'cal@group.calendar.google.com' }) });
            mockDeleteCalendarEvent.mockResolvedValue(undefined);
            mockCreateInAppNotification.mockResolvedValue(undefined);
            mockSendPushToUser.mockResolvedValue(undefined);

            const event = makeUpdateEvent(
                { status: 'confirmed', vehicleId: 'v1', calendarEventId: 'ev1', date: '2026-01-01', startTime: '09:00' },
                { status: 'cancelled', vehicleId: 'v1', calendarEventId: 'ev1', userId: 'user1', organizationId: 'org1', date: '2026-01-01', startTime: '09:00' }
            );
            await (onReservationUpdated as Function)(event);

            expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('cal@group.calendar.google.com', 'ev1');
            expect(mockCreateInAppNotification).toHaveBeenCalledWith(
                'user1', 'reservation_cancelled', expect.any(String), expect.any(String), 'org1'
            );
        });
    });

    describe('onReservationDeleted', () => {
        it('calendarEventId가 없으면 아무것도 하지 않는다', async () => {
            const event = makeDeleteEvent({ vehicleId: 'v1' });
            await (onReservationDeleted as Function)(event);
            expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
        });

        it('정상 삭제 시 캘린더 이벤트를 삭제한다', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ googleCalendarId: 'cal@group.calendar.google.com' }) });
            mockDeleteCalendarEvent.mockResolvedValue(undefined);

            const event = makeDeleteEvent({ vehicleId: 'v1', calendarEventId: 'ev1' });
            await (onReservationDeleted as Function)(event);

            expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('cal@group.calendar.google.com', 'ev1');
        });
    });
});
