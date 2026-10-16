/**
 * testCalendarAccess.test.ts — 관리자의 캘린더 공유 설정 진단
 * - 지키는 것: 관리자 이상만, 시간당 상한(후보 ID를 훑는 오라클 방지, 2026-08-23 감사 발견 1),
 *   **다른 기관에 귀속된 캘린더는 접근 여부를 알려주지 않음**(superAdmin은 진단을 위해 예외),
 *   서비스 계정 주소 오입력 안내, 읽기 전용 스코프로 1건만 조회, 오류 코드별 안내
 */

const mockCheckRateLimitByUid = jest.fn().mockResolvedValue(undefined);
const mockGetCalendarBindingOwner = jest.fn().mockResolvedValue(null);
const mockEventsList = jest.fn().mockResolvedValue({ data: { items: [] } });
const mockGoogleAuth = jest.fn();

jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimitByUid(...args),
}));
jest.mock('../utils/constants', () => ({
    ...jest.requireActual('../utils/constants'),
    getRateLimits: jest.fn(async () => ({ max: 20, windowSec: 3600 })),
}));
jest.mock('../services/calendar/calendarBinding', () => ({
    getCalendarBindingOwner: (...args: unknown[]) => mockGetCalendarBindingOwner(...args),
}));
jest.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth: function GoogleAuth(this: unknown, opts: unknown) { mockGoogleAuth(opts); } },
        calendar: () => ({ events: { list: (...args: unknown[]) => mockEventsList(...args) } }),
    },
}));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { testCalendarAccess } from '../handlers/callable/testCalendarAccess';

const handler = testCalendarAccess as unknown as (req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const admin = { uid: 'a1', token: { role: 'admin', orgId: 'org1' } };
const call = (calendarId: unknown, auth: unknown = admin) => handler({ auth, data: { calendarId } });
const CAL = 'abc123@group.calendar.google.com';

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimitByUid.mockResolvedValue(undefined);
    mockGetCalendarBindingOwner.mockResolvedValue(null);
    mockEventsList.mockResolvedValue({ data: { items: [] } });
});

describe('testCalendarAccess — 권한·입력', () => {
    it('로그인하지 않으면 거부한다', async () => {
        await expect(call(CAL, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each(['employee', undefined])('role=%s는 거부한다', async (role) => {
        await expect(call(CAL, { uid: 'u1', token: { role, orgId: 'org1' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCheckRateLimitByUid).not.toHaveBeenCalled();
    });

    it.each([undefined, '', '   '])('캘린더 ID %p는 거부한다', async (calendarId) => {
        await expect(call(calendarId)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('호출자 uid로 시간당 상한을 건다 — 걸리면 귀속·접근을 확인하지 않는다', async () => {
        const err = Object.assign(new Error('too many'), { code: 'resource-exhausted' });
        mockCheckRateLimitByUid.mockRejectedValueOnce(err);
        await expect(call(CAL)).rejects.toBe(err);
        expect(mockCheckRateLimitByUid).toHaveBeenCalledWith('testCalendarAccess', 'a1', 20, 3600);
        expect(mockGetCalendarBindingOwner).not.toHaveBeenCalled();
        expect(mockEventsList).not.toHaveBeenCalled();
    });

    it('서비스 계정 주소를 캘린더 ID로 넣으면 접근 시도 없이 원인을 알려준다', async () => {
        await expect(call(' Vehicle-Sync@vehicle-drive-log.iam.GSERVICEACCOUNT.com ')).resolves.toMatchObject({
            success: false, errorType: 'SERVICE_ACCOUNT_ADDRESS',
        });
        expect(mockEventsList).not.toHaveBeenCalled();
    });
});

describe('testCalendarAccess — 다른 기관 캘린더', () => {
    it('다른 기관에 귀속된 캘린더는 접근 여부를 알려주지 않는다', async () => {
        mockGetCalendarBindingOwner.mockResolvedValueOnce('org2');
        await expect(call(CAL)).resolves.toMatchObject({ success: false, errorType: 'BOUND_TO_OTHER_ORG' });
        expect(mockGetCalendarBindingOwner).toHaveBeenCalledWith(CAL);
        expect(mockEventsList).not.toHaveBeenCalled();
    });

    it('우리 기관에 귀속된 캘린더는 진단한다(organizationId 클레임도 인정)', async () => {
        mockGetCalendarBindingOwner.mockResolvedValue('org1');
        await expect(call(CAL)).resolves.toMatchObject({ success: true });
        await expect(call(CAL, { uid: 'a1', token: { role: 'admin', organizationId: 'org1' } })).resolves.toMatchObject({ success: true });
    });

    it('superAdmin은 귀속을 묻지 않고 진단한다(기관 미소속 운영자)', async () => {
        await expect(call(CAL, { uid: 'sa1', token: { role: 'superAdmin' } })).resolves.toMatchObject({ success: true });
        expect(mockGetCalendarBindingOwner).not.toHaveBeenCalled();
    });
});

describe('testCalendarAccess — 접근 확인', () => {
    it('읽기 전용 스코프로, 앞뒤 공백을 걷은 ID의 이벤트 1건만 조회한다', async () => {
        await expect(call(`  ${CAL}  `)).resolves.toEqual({
            success: true, message: expect.stringContaining('정상'),
        });
        expect(mockGoogleAuth).toHaveBeenCalledWith({ scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
        expect(mockEventsList).toHaveBeenCalledWith(expect.objectContaining({ calendarId: CAL, maxResults: 1, singleEvents: true }));
    });

    it.each([
        [403, 'FORBIDDEN', '서비스 계정'],
        [404, 'NOT_FOUND', '캘린더 ID'],
    ])('%s 오류는 %s 안내로', async (code, errorType, hint) => {
        mockEventsList.mockRejectedValueOnce(Object.assign(new Error('google error'), { code }));
        const result = await call(CAL);
        expect(result).toMatchObject({ success: false, errorType });
        expect(result.message).toContain(hint);
    });

    it('그 밖의 오류는 UNKNOWN으로 원문을 담는다', async () => {
        mockEventsList.mockRejectedValueOnce(Object.assign(new Error('Backend Error'), { code: 500 }));
        await expect(call(CAL)).resolves.toMatchObject({
            success: false, errorType: 'UNKNOWN', message: expect.stringContaining('Backend Error'),
        });
    });
});
