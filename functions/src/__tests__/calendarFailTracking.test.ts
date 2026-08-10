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
    isCalendarAuthError,
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

    describe('isCalendarAuthError() — 설정 오류 판별', () => {
        it('메시지가 "Forbidden"이면 설정 오류로 본다 (숫자 없는 사유 문구)', () => {
            // 실제 Sentry에 잡힌 형태. 숫자 403이 없어 예전 문자열 검사로는 놓쳤고,
            // 그래서 백오프가 발동하지 않아 같은 차량이 매 예약 변경마다 알림을 쌓았다.
            expect(isCalendarAuthError(new Error('Forbidden'))).toBe(true);
        });

        it('상태 코드로도 판별한다 (code / status / response.status)', () => {
            expect(isCalendarAuthError({ code: 403, message: '' })).toBe(true);
            expect(isCalendarAuthError({ code: 404, message: '' })).toBe(true);
            expect(isCalendarAuthError({ status: 403, message: '' })).toBe(true);
            expect(isCalendarAuthError({ response: { status: 404 }, message: '' })).toBe(true);
        });

        it('문자열 상태 코드도 인식한다', () => {
            expect(isCalendarAuthError({ code: '403', message: 'Request failed' })).toBe(true);
        });

        it('기존 메시지 형태(Not Found·404·403)는 그대로 인식한다', () => {
            expect(isCalendarAuthError(new Error('Not Found'))).toBe(true);
            expect(isCalendarAuthError(new Error('Request failed with status code 404'))).toBe(true);
            expect(isCalendarAuthError(new Error('403 insufficient permissions'))).toBe(true);
        });

        it('설정 오류가 아닌 실패는 false — 진짜 장애는 Sentry로 올라가야 한다', () => {
            expect(isCalendarAuthError(new Error('Internal Server Error'))).toBe(false);
            expect(isCalendarAuthError({ code: 500, message: 'Backend Error' })).toBe(false);
            expect(isCalendarAuthError({ code: 'ETIMEDOUT', message: 'socket hang up' })).toBe(false);
            expect(isCalendarAuthError(new Error('quota exceeded'))).toBe(false);
        });

        it('null·undefined에도 안전하다', () => {
            expect(isCalendarAuthError(null)).toBe(false);
            expect(isCalendarAuthError(undefined)).toBe(false);
        });
    });
});
