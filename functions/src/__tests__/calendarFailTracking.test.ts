/**
 * calendarFailTracking.test.ts — 캘린더 동기화 실패 백오프 공통 모듈 테스트
 *
 * shouldSkipVehicleCalendar(쿨다운/영구제외 판단)와 recordCalendarFailure(카운터 캡)를 검증한다.
 */

// ── Firestore mock ──
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({ update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

import {
    shouldSkipVehicleCalendar,
    recordCalendarFailure,
    MAX_FAIL_COUNT,
    RETRY_COOLDOWN_MS,
} from '../services/calendar/calendarFailTracking';

describe('calendarFailTracking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    describe('shouldSkipVehicleCalendar()', () => {
        it('failCount < 3 이면 건너뛰지 않음', () => {
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 0 })).toBe(false);
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 2 })).toBe(false);
        });

        it('failCount >= MAX_FAIL_COUNT(영구제외)면 항상 건너뜀', () => {
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: MAX_FAIL_COUNT })).toBe(true);
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 192 })).toBe(true);
        });

        it('failCount 3~9 + 마지막 실패가 24h 이내면 쿨다운으로 건너뜀', () => {
            const recent = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 5, calendarSyncLastFailAt: recent })).toBe(true);
        });

        it('failCount 3~9 + 마지막 실패가 24h 초과면 재시도 허용(건너뛰지 않음)', () => {
            const old = new Date(Date.now() - RETRY_COOLDOWN_MS - 60 * 1000); // 24h + 1분 전
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 5, calendarSyncLastFailAt: old })).toBe(false);
        });
    });

    describe('recordCalendarFailure() — 카운터 캡', () => {
        it('일반 증가: currentFailCount + 1', async () => {
            const next = await recordCalendarFailure('v1', 2);
            expect(next).toBe(3);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFailCount: 3 }));
        });

        it('MAX 도달 시 더 증가하지 않고 MAX로 캡', async () => {
            const next = await recordCalendarFailure('v1', MAX_FAIL_COUNT);
            expect(next).toBe(MAX_FAIL_COUNT);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFailCount: MAX_FAIL_COUNT }));
        });

        it('이미 MAX를 초과한 오염된 값(예: 191)도 MAX로 수렴', async () => {
            const next = await recordCalendarFailure('v1', 191);
            expect(next).toBe(MAX_FAIL_COUNT);
        });
    });
});
