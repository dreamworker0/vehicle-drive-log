/**
 * reservationReminderScheduler.test.ts — 리마인더 실패 시 heartbeat 회귀 테스트
 *
 * 예전에는 checkReservationReminders가 실패를 삼켜, 스케줄러가 그 뒤에 heartbeat를 찍었다.
 * 그러면 알림 기능이 통째로 죽어도 apiHealthCheck가 "정상"으로 판정한다.
 */

jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock('../core/params', () => ({ SLACK_TOKEN_ENC_KEY: {} }));

const mockCheckReservationReminders = jest.fn();
jest.mock('../services/alimtalk/reservationReminder', () => ({
    checkReservationReminders: () => mockCheckReservationReminders(),
}));
const mockWarmup = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/ocr/warmupOcr', () => ({ warmupOcrFunction: () => mockWarmup() }));

const mockRecordHeartbeat = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/helpers', () => ({ recordHeartbeat: (name: string) => mockRecordHeartbeat(name) }));

const mockFlushSentry = jest.fn().mockResolvedValue(undefined);
jest.mock('../core/sentry', () => ({ flushSentry: () => mockFlushSentry() }));

import { reservationReminder } from '../handlers/scheduled/reservationReminderScheduler';

const run = reservationReminder as unknown as () => Promise<void>;

describe('reservationReminder 스케줄러', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-04T01:00:00Z')); // 수요일 10:00 KST
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('정상 실행이면 heartbeat를 찍는다', async () => {
        mockCheckReservationReminders.mockResolvedValueOnce(undefined);

        await run();

        expect(mockRecordHeartbeat).toHaveBeenCalledWith('reservationReminder');
        expect(mockFlushSentry).not.toHaveBeenCalled();
    });

    it('알림 처리가 실패하면 flush 후 다시 던지고 heartbeat를 찍지 않는다', async () => {
        mockCheckReservationReminders.mockRejectedValueOnce(new Error('UNAVAILABLE'));

        await expect(run()).rejects.toThrow('UNAVAILABLE');

        expect(mockFlushSentry).toHaveBeenCalled();
        expect(mockRecordHeartbeat).not.toHaveBeenCalled();
        expect(mockWarmup).not.toHaveBeenCalled();
    });
});
