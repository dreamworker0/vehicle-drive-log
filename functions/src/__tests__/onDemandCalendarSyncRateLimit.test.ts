/**
 * onDemandCalendarSyncRateLimit.test.ts — 온디맨드 캘린더 동기화 호출 빈도 제한
 *
 * 이 콜러블은 예약 캘린더를 열 때마다 백그라운드로 자동 호출된다. 30분 쿨다운이
 * 클라이언트(useCalendarSync의 브라우저 저장소)에만 있었으므로 기기·사용자가 늘면
 * 같은 차량의 캘린더를 30분 안에 몇 번이고 다시 긁었다 — 호출 1건이 Google Calendar
 * API 조회 + 예약 범위 쿼리다.
 *
 * 여기서 고정하는 계약:
 *   1. 상한 초과 시 **예외를 던지지 않는다.** 던지면 클라이언트가 3회 재시도해
 *      호출이 오히려 늘어난다. errorType "rate-limited" 소프트 스킵으로 돌려준다.
 *   2. 소프트 스킵일 때 동기화 본체를 부르지 않는다 (= 비용이 발생하지 않는다).
 *   3. 차량 키에서 막히면 uid 카운터는 올리지 않는다 (거절할 요청에 쓰기 낭비 금지).
 *   4. 통과하면 동기화가 실제로 돈다 (가드가 정상 경로를 막지 않는다).
 */

const mockVehicleGet = jest.fn();
const mockUserGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: () => ({ get: name === 'vehicles' ? mockVehicleGet : mockUserGet }),
        }),
    }),
}));

jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    }
    return {
        HttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
    };
});

const mockSyncSingle = jest.fn();
jest.mock('../handlers/scheduled/calendarSchedule', () => ({
    syncSingleVehicleCalendar: (...args: unknown[]) => mockSyncSingle(...args),
}));

jest.mock('../services/calendar/calendarFailTracking', () => ({
    isCalendarAuthError: () => false,
    recordCalendarFailure: jest.fn(),
    resetCalendarFailure: jest.fn(),
    shouldSkipVehicleCalendar: () => false,
    MAX_FAIL_COUNT: 10,
}));

const mockCheckSubject = jest.fn();
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitBySubject: (...args: unknown[]) => mockCheckSubject(...args),
}));

jest.mock('../utils/constants', () => ({
    getRateLimits: async (name: string) => ({ max: name.endsWith('Vehicle') ? 6 : 6, windowSec: 1800 }),
}));

import { triggerOnDemandCalendarSync } from '../handlers/callable/triggerOnDemandCalendarSync';

const ORG = 'org-1';
const VEHICLE_ID = 'veh-1';

// onCall이 handler를 그대로 돌려주도록 mock했으므로 CallableRequest 형태로 직접 호출한다.
type Handler = (req: unknown) => Promise<{ success: boolean; errorType?: string; message?: string }>;
const handler = triggerOnDemandCalendarSync as unknown as Handler;

function request() {
    return {
        auth: { uid: 'uid-1', token: { organizationId: ORG } },
        data: { vehicleId: VEHICLE_ID, organizationId: ORG },
    };
}

describe('triggerOnDemandCalendarSync — 호출 빈도 제한', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockVehicleGet.mockResolvedValue({
            exists: true,
            data: () => ({ organizationId: ORG, googleCalendarId: 'cal@group.calendar.google.com' }),
        });
        mockSyncSingle.mockResolvedValue({ created: 0, updated: 0, cancelled: 0, skippedDup: 0 });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('상한 이내면 동기화가 실제로 돈다', async () => {
        mockCheckSubject.mockResolvedValue(false); // 차량·uid 둘 다 통과

        const res = await handler(request());

        expect(res.success).toBe(true);
        expect(mockSyncSingle).toHaveBeenCalledWith(VEHICLE_ID, expect.any(Object));
        expect(mockCheckSubject).toHaveBeenCalledTimes(2); // 차량 → uid 순서로 둘 다 확인
    });

    it('차량 상한 초과 시 예외 없이 소프트 스킵을 돌려주고 동기화를 부르지 않는다', async () => {
        mockCheckSubject.mockResolvedValueOnce(true); // 차량 키에서 막힘

        const res = await handler(request());

        expect(res).toEqual({
            success: false,
            errorType: 'rate-limited',
            message: expect.any(String),
        });
        expect(mockSyncSingle).not.toHaveBeenCalled();
    });

    it('차량 키에서 막히면 uid 카운터는 올리지 않는다 — 거절할 요청에 쓰기를 낭비하지 않는다', async () => {
        mockCheckSubject.mockResolvedValueOnce(true); // 차량 키에서 막힘

        await handler(request());

        expect(mockCheckSubject).toHaveBeenCalledTimes(1);
        expect(mockCheckSubject).toHaveBeenCalledWith(
            'triggerOnDemandCalendarSync:vehicle', VEHICLE_ID, 6, 1800, 'closed',
        );
    });

    it('uid 상한 초과도 소프트 스킵이다 — 기관 차량을 돌려가며 호출하는 경로 차단', async () => {
        mockCheckSubject
            .mockResolvedValueOnce(false) // 차량은 통과
            .mockResolvedValueOnce(true);  // uid에서 막힘

        const res = await handler(request());

        expect(res.errorType).toBe('rate-limited');
        expect(mockSyncSingle).not.toHaveBeenCalled();
        expect(mockCheckSubject).toHaveBeenNthCalledWith(
            2, 'triggerOnDemandCalendarSync', 'uid-1', 6, 1800, 'closed',
        );
    });

    it('두 카운터 모두 fail-closed다 — 한도를 확인할 수 없으면 통과시키지 않는다', async () => {
        mockCheckSubject.mockResolvedValue(false);

        await handler(request());

        for (const call of mockCheckSubject.mock.calls) {
            expect(call[4]).toBe('closed');
        }
    });

    it('다른 기관 차량 요청은 빈도 제한보다 먼저 권한에서 막힌다', async () => {
        mockCheckSubject.mockResolvedValue(false);
        const req = request();
        req.data.organizationId = 'other-org';

        await expect(handler(req)).rejects.toThrow(/권한이 없습니다/);
        expect(mockCheckSubject).not.toHaveBeenCalled();
        expect(mockSyncSingle).not.toHaveBeenCalled();
    });
});
