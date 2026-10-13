/**
 * calendarScheduleFailure.test.ts — 캘린더 역동기화 회차 전체 실패의 보고 회귀 테스트
 *
 * 예전에는 회차 전체가 죽어도 console.error만 남아 Sentry·Discord 어디에도 닿지 않았다.
 * 이 함수는 Cloud Run 비용 1위라 조용히 죽는 쪽이 가장 늦게 발견된다.
 */

const mockVehiclesGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => {
            const q: Record<string, unknown> = {};
            q.where = () => q;
            q.get = () => mockVehiclesGet();
            return q;
        },
    }),
    FieldValue: { serverTimestamp: jest.fn() },
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock('../core/discord', () => ({ sendDiscordAlert: jest.fn() }));

const mockRecordHeartbeat = jest.fn();
jest.mock('../utils/helpers', () => ({ recordHeartbeat: mockRecordHeartbeat }));

const mockCaptureError = jest.fn();
const mockFlushSentry = jest.fn().mockResolvedValue(undefined);
jest.mock('../core/sentry', () => ({
    captureError: mockCaptureError,
    flushSentry: mockFlushSentry,
}));

import { syncCalendarToApp } from '../handlers/scheduled/calendarSchedule';

describe('syncCalendarToApp — 회차 전체 실패', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-04T01:00:00Z')); // 수요일 10:00 KST (활성 창 안)
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('captureError로 올리고 flush하며, heartbeat는 찍지 않는다', async () => {
        const failure = new Error('DEADLINE_EXCEEDED');
        mockVehiclesGet.mockRejectedValueOnce(failure);

        await (syncCalendarToApp as unknown as () => Promise<void>)();

        expect(mockCaptureError).toHaveBeenCalledWith(failure, { context: 'syncCalendarToApp' });
        expect(mockFlushSentry).toHaveBeenCalled();
        expect(mockRecordHeartbeat).not.toHaveBeenCalled();
    });
});
