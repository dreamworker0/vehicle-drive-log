/**
 * probeCalendarAccess.test.ts — 연동 캘린더 일괄 접근 진단 단위 테스트
 *
 * 회귀 대상:
 *  - **쓰기를 하지 않는다** (이 함수의 안전 보증. 진단이 조용히 상태를 바꾸면 안 된다)
 *  - 같은 캘린더를 쓰는 차량을 묶어 캘린더당 한 번만 호출한다 (쿼터)
 *  - 값 자체가 틀린 경우는 API를 부르기 전에 가른다
 *  - 404/403을 구분해 돌려준다 (기관이 할 조치가 다르다)
 *  - "살아 있는데 카운터에 막힌 것"과 "죽은 것"을 요약에서 가른다 — 리셋 판단의 근거
 */

// ── Firestore mock ──
const mockVehiclesGet = jest.fn();
const mockOrgGet = jest.fn();
// 쓰기 경로 — 한 번도 불리면 안 된다
const mockUpdate = jest.fn();
const mockSet = jest.fn();
const mockBatch = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'vehicles') {
                return {
                    where: () => ({ get: mockVehiclesGet }),
                    doc: () => ({ update: mockUpdate, set: mockSet }),
                };
            }
            return {
                doc: (id: string) => ({ get: () => mockOrgGet(id), update: mockUpdate, set: mockSet }),
            };
        },
        batch: mockBatch,
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
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

const mockLog = jest.fn();
jest.mock('../utils/helpers', () => ({
    log: (...args: unknown[]) => mockLog(...args),
    requireSuperAdmin: (req: { auth?: { token?: { role?: string } } }) => {
        if (req?.auth?.token?.role !== 'superAdmin') {
            throw new Error('permission-denied');
        }
    },
}));

jest.mock('../services/calendar/calendarBinding', () => ({
    normalizeCalendarId: (s: string) => s.trim().toLowerCase(),
}));

// ── Google Calendar mock ──
const mockEventsList = jest.fn();
jest.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth: class { } },
        calendar: () => ({ events: { list: (...args: unknown[]) => mockEventsList(...args) } }),
    },
}));

import { probeCalendarAccess } from '../handlers/callable/probeCalendarAccess';

type Handler = (req: unknown) => Promise<{
    summary: Record<string, number | boolean>;
    rows: Array<{
        calendarId: string;
        verdict: string;
        vehicleCount: number;
        maxFailCount: number;
        organizationName: string;
        calendarEnabled: boolean;
        organizationStatus: string;
    }>;
}>;
const probe = probeCalendarAccess as unknown as Handler;

/** 차량 문서 mock */
const vehicle = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

/** 기관 문서 mock */
const org = (data: Record<string, unknown> | null) => ({
    exists: data !== null,
    data: () => data ?? undefined,
});

/** googleapis 오류 모양 */
const apiError = (code: number, message: string) => Object.assign(new Error(message), { code });

const superAdminReq = (data: Record<string, unknown> = {}) => ({
    auth: { uid: 'sa-1', token: { role: 'superAdmin' } },
    data,
});

describe('probeCalendarAccess', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOrgGet.mockResolvedValue(org({ name: '테스트기관', status: 'approved' }));
        mockEventsList.mockResolvedValue({ data: { items: [] } });
    });

    describe('권한', () => {
        it('슈퍼관리자가 아니면 거부한다', async () => {
            await expect(probe({ auth: { uid: 'u1', token: { role: 'admin' } }, data: {} }))
                .rejects.toThrow('permission-denied');
            expect(mockVehiclesGet).not.toHaveBeenCalled();
        });
    });

    describe('읽기 전용 보증', () => {
        it('어떤 경로로도 Firestore에 쓰지 않는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'live@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'dead@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });
            mockEventsList.mockImplementation((args: { calendarId: string }) =>
                args.calendarId === 'dead@example.or.kr'
                    ? Promise.reject(apiError(404, 'Not Found'))
                    : Promise.resolve({ data: { items: [] } }),
            );

            await probe(superAdminReq());

            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockSet).not.toHaveBeenCalled();
            expect(mockBatch).not.toHaveBeenCalled();
        });
    });

    describe('그룹핑', () => {
        it('같은 캘린더를 쓰는 차량이 여러 대여도 캘린더당 한 번만 호출한다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'shared@example.or.kr', organizationId: 'o1', displayName: '모닝', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'shared@example.or.kr', organizationId: 'o1', displayName: '카니발', calendarSyncFailCount: 10 }),
                    vehicle('v3', { googleCalendarId: 'SHARED@example.or.kr ', organizationId: 'o1', displayName: '스타렉스', calendarSyncFailCount: 4 }),
                ],
            });

            const res = await probe(superAdminReq());

            // 대소문자·공백 차이는 같은 캘린더다 (normalizeCalendarId)
            expect(mockEventsList).toHaveBeenCalledTimes(1);
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].vehicleCount).toBe(3);
            // 그룹의 failCount는 최대값 — 영구중단 여부 판단에 쓰인다
            expect(res.rows[0].maxFailCount).toBe(10);
        });
    });

    describe('진단 분류', () => {
        it('접근 가능하면 ok', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'live@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('ok');
        });

        it('404는 not_found, 403은 forbidden으로 가른다 (기관이 할 조치가 다르다)', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'gone@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'noperm@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });
            mockEventsList.mockImplementation((args: { calendarId: string }) =>
                Promise.reject(args.calendarId === 'gone@example.or.kr'
                    ? apiError(404, 'Not Found')
                    : apiError(403, 'Forbidden')),
            );

            const res = await probe(superAdminReq());
            const byId = Object.fromEntries(res.rows.map(r => [r.calendarId, r.verdict]));
            expect(byId['gone@example.or.kr']).toBe('not_found');
            expect(byId['noperm@example.or.kr']).toBe('forbidden');
        });

        it('response.status 형태의 오류도 상태 코드로 읽는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'gone@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            mockEventsList.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));

            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('not_found');
        });

        it('설정 오류(서비스 계정 주소·@ 없는 값)는 캘린더 API를 부르기 전에 가른다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: '1066541065552-compute@developer.gserviceaccount.com', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'https://calendar.google.com/r/month/2026/8/1', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq());

            expect(mockEventsList).not.toHaveBeenCalled();
            const verdicts = res.rows.map(r => r.verdict).sort();
            expect(verdicts).toEqual(['malformed', 'service_account_address']);
        });
    });

    describe('대상 선별', () => {
        it('기본은 실패가 누적된 차량만 본다 (정상 차량까지 매번 두드리지 않는다)', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'healthy@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 0 }),
                    vehicle('v2', { googleCalendarId: 'failing@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq());
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].calendarId).toBe('failing@example.or.kr');
        });

        it('includeHealthy면 정상 차량까지 전부 본다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'healthy@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 0 }),
                    vehicle('v2', { googleCalendarId: 'failing@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq({ includeHealthy: true }));
            expect(res.rows).toHaveLength(2);
        });
    });

    describe('요약 — 리셋 판단의 근거', () => {
        it('살아 있는데 카운터에 막힌 것과 죽은 것을 가른다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    // 공유가 살아 있는데 카운터가 막고 있다 → 리셋만으로 복구
                    vehicle('v1', { googleCalendarId: 'live@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'live@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    // 죽었다 → 기관이 다시 공유해야 한다
                    vehicle('v3', { googleCalendarId: 'dead@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });
            mockEventsList.mockImplementation((args: { calendarId: string }) =>
                args.calendarId === 'dead@example.or.kr'
                    ? Promise.reject(apiError(404, 'Not Found'))
                    : Promise.resolve({ data: { items: [] } }),
            );

            const res = await probe(superAdminReq());

            expect(res.summary.resettableCalendars).toBe(1);
            expect(res.summary.resettableVehicles).toBe(2);
            expect(res.summary.needsOrgActionCalendars).toBe(1);
            expect(res.summary.needsOrgActionVehicles).toBe(1);
        });

        it('캘린더 기능이 꺼졌거나 기관 문서가 없는 차량은 오탐으로 집계한다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'off@example.or.kr', organizationId: 'o-off', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'orphan@example.or.kr', organizationId: 'o-gone', calendarSyncFailCount: 10 }),
                ],
            });
            mockOrgGet.mockImplementation((id: string) =>
                Promise.resolve(id === 'o-off'
                    ? org({ name: '기능끔기관', status: 'approved', googleCalendarEnabled: false })
                    : org(null)),
            );
            mockEventsList.mockRejectedValue(apiError(404, 'Not Found'));

            const res = await probe(superAdminReq());

            expect(res.summary.falsePositiveCalendars).toBe(2);
            expect(res.summary.falsePositiveVehicles).toBe(2);
            const offRow = res.rows.find(r => r.calendarId === 'off@example.or.kr')!;
            expect(offRow.calendarEnabled).toBe(false);
            const orphanRow = res.rows.find(r => r.calendarId === 'orphan@example.or.kr')!;
            expect(orphanRow.organizationStatus).toBe('(문서없음)');
        });

        it('기관 문서는 기관마다 한 번만 읽는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'a@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'b@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            await probe(superAdminReq());
            expect(mockOrgGet).toHaveBeenCalledTimes(1);
        });
    });
});
