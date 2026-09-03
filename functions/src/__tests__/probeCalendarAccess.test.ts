/**
 * probeCalendarAccess.test.ts — 연동 캘린더 일괄 접근 진단 단위 테스트
 *
 * 회귀 대상:
 *  - **진단 대상에 쓰지 않는다**, 특히 바인딩 **선점 등록** 경로를 부르지 않는다
 *  - 운영 경로와 같은 순서로 판정한다 (값 형식 → 기관 바인딩 → 캘린더 접근)
 *  - 기관 × 캘린더로 묶는다 — 같은 ID를 쓰는 다른 기관이 한 행에 뭉쳐 사라지지 않는다
 *  - 404/403/쿼터403을 구분한다 (기관이 할 조치가 각각 다르다)
 *  - 요약 네 갈래가 **배타적**이다 — 겹치면 운영자가 규모를 과대평가한다
 */

// ── Firestore mock ──
const mockVehiclesGet = jest.fn();
/** orgId → 문서 데이터 (null이면 문서 없음) */
const orgData = new Map<string, Record<string, unknown> | null>();
// 쓰기 경로 — 한 번도 불리면 안 된다
const mockUpdate = jest.fn();
const mockSet = jest.fn();
const mockBatch = jest.fn();
const mockGetAll = jest.fn((...refs: Array<{ id: string }>) =>
    Promise.resolve(refs.map((r) => ({
        id: r.id,
        exists: orgData.get(r.id) != null,
        data: () => orgData.get(r.id) ?? undefined,
    }))),
);

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
                doc: (id: string) => ({ id, update: mockUpdate, set: mockSet }),
            };
        },
        getAll: (...refs: Array<{ id: string }>) => mockGetAll(...refs),
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

const mockCheckRateLimit = jest.fn();
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

jest.mock('../utils/constants', () => ({
    getRateLimits: jest.fn(async () => ({ max: 6, windowSec: 3600 })),
}));

/**
 * 바인딩 모듈 — **`isCalendarBoundToOrg`는 미등록 ID를 선점 등록(create)한다.** 진단이
 * 그 경로를 타면 아직 동기화를 돌리지 않은 기관의 캘린더를 버튼 한 번으로 가져간다.
 * 호출 자체를 회귀로 잡기 위해 던지도록 둔다.
 */
const mockBindingOwner = jest.fn();
jest.mock('../services/calendar/calendarBinding', () => ({
    normalizeCalendarId: (s: string) => s.trim().toLowerCase(),
    getCalendarBindingOwner: (...args: unknown[]) => mockBindingOwner(...args),
    isCalendarBoundToOrg: () => {
        throw new Error('진단은 바인딩 선점 등록 경로를 불러선 안 된다');
    },
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
import { MAX_FAIL_COUNT } from '../services/calendar/calendarFailTracking';

interface Row {
    calendarId: string;
    organizationId: string;
    organizationName: string;
    organizationStatus: string;
    calendarEnabled: boolean;
    verdict: string;
    vehicleCount: number;
    blockedVehicleCount: number;
    maxFailCount: number;
    detail?: string;
}
type Handler = (req: unknown) => Promise<{ summary: Record<string, number | boolean>; rows: Row[] }>;
const probe = probeCalendarAccess as unknown as Handler;

/** 차량 문서 mock */
const vehicle = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

/** googleapis 오류 모양 */
const apiError = (code: number, message: string, reason?: string) =>
    Object.assign(new Error(message), { code, ...(reason ? { errors: [{ reason }] } : {}) });

const superAdminReq = (data: Record<string, unknown> = {}) => ({
    auth: { uid: 'sa-1', token: { role: 'superAdmin' } },
    data,
});

describe('probeCalendarAccess', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        orgData.clear();
        orgData.set('o1', { name: '테스트기관', status: 'approved' });
        mockBindingOwner.mockResolvedValue(null); // 기본: 미등록(선점 전) — 동기화가 진행되는 상태
        mockEventsList.mockResolvedValue({ data: { items: [] } });
    });

    describe('권한·남용 방지', () => {
        it('슈퍼관리자가 아니면 거부한다', async () => {
            await expect(probe({ auth: { uid: 'u1', token: { role: 'admin' } }, data: {} }))
                .rejects.toThrow('permission-denied');
            expect(mockVehiclesGet).not.toHaveBeenCalled();
        });

        it('호출 상한을 확인한다 — 반복 호출이 곧 캘린더 쿼터 소모다', async () => {
            mockVehiclesGet.mockResolvedValue({ docs: [] });
            await probe(superAdminReq());
            expect(mockCheckRateLimit).toHaveBeenCalledWith('probeCalendarAccess', 'sa-1', 6, 3600);
        });
    });

    describe('진단 대상 무변경 보증', () => {
        it('어떤 경로로도 진단 대상에 쓰지 않는다', async () => {
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

        it('바인딩은 선점하지 않는 조회로만 읽는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'a@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            // isCalendarBoundToOrg가 불리면 모킹이 던지므로 이 호출 자체가 실패한다
            await expect(probe(superAdminReq())).resolves.toBeDefined();
            expect(mockBindingOwner).toHaveBeenCalledWith('a@example.or.kr');
        });
    });

    describe('기관 × 캘린더 그룹핑', () => {
        it('같은 기관의 같은 캘린더는 한 행으로 묶고 API를 한 번만 호출한다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'shared@example.or.kr', organizationId: 'o1', displayName: '모닝', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'shared@example.or.kr', organizationId: 'o1', displayName: '카니발', calendarSyncFailCount: 10 }),
                    vehicle('v3', { googleCalendarId: 'SHARED@example.or.kr ', organizationId: 'o1', displayName: '스타렉스', calendarSyncFailCount: 4 }),
                ],
            });

            const res = await probe(superAdminReq());

            expect(mockEventsList).toHaveBeenCalledTimes(1);
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].vehicleCount).toBe(3);
            // 영구중단은 2대 — 조치 규모는 이 수로 센다 (failCount 4는 24h 후 자동 재시도)
            expect(res.rows[0].blockedVehicleCount).toBe(2);
            expect(res.rows[0].maxFailCount).toBe(10);
        });

        it('같은 캘린더를 다른 기관이 쓰면 기관별로 갈라 보여준다 (기관이 사라지지 않는다)', async () => {
            orgData.set('o2', { name: '다른기관', status: 'approved' });
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'same@example.or.kr', organizationId: 'o1', displayName: '모닝', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'same@example.or.kr', organizationId: 'o2', displayName: '카니발', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq());

            expect(res.rows).toHaveLength(2);
            expect(res.rows.map(r => r.organizationName).sort()).toEqual(['다른기관', '테스트기관']);
            // 쿼터 절약은 유지 — 캘린더 판정은 서비스 계정 신원 기준이라 한 번이면 된다
            expect(mockEventsList).toHaveBeenCalledTimes(1);
            expect(res.summary.calendarApiCalls).toBe(1);
        });
    });

    describe('바인딩 게이트 — 운영 경로와 같은 순서', () => {
        it('다른 기관에 귀속된 캘린더는 접근 가능해도 bound_to_other_org로 판정한다', async () => {
            mockBindingOwner.mockResolvedValue('other-org');
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'taken@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });

            const res = await probe(superAdminReq());

            expect(res.rows[0].verdict).toBe('bound_to_other_org');
            // 막힐 요청은 보내지 않는다 (calendarBinding의 설계 원칙)
            expect(mockEventsList).not.toHaveBeenCalled();
            // 리셋해도 동기화가 건너뛰므로 '리셋만으로 복구'에 들어가면 안 된다
            expect(res.summary.resettableRows).toBe(0);
            expect(res.summary.needsOrgActionVehicles).toBe(1);
        });

        it('자기 기관 소유면 정상 진단한다', async () => {
            mockBindingOwner.mockResolvedValue('o1');
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'mine@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });

            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('ok');
            expect(res.summary.resettableVehicles).toBe(1);
        });
    });

    describe('진단 분류', () => {
        it('404는 not_found, 403은 forbidden으로 가른다', async () => {
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

        it('숫자 코드 없이 사유 문구만 오는 오류도 운영 경로와 같은 기준으로 읽는다', async () => {
            // isCalendarAuthError가 failCount를 올리는 바로 그 형태 — 진단이 '기타 오류'로
            // 흘리면 운영 경로와 판정이 갈린다
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'x@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            mockEventsList.mockRejectedValue(new Error('Forbidden'));

            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('forbidden');
        });

        it('response.status 형태의 오류도 상태 코드로 읽는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'gone@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            mockEventsList.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));

            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('not_found');
        });

        it('쿼터·유량 403은 rate_limited로 갈라 기관 조치 대상에서 뺀다', async () => {
            // Calendar API는 쿼터 초과도 403으로 준다 — '권한 없음'으로 읽으면 기관에 헛수고를 시킨다
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'busy@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 })],
            });
            mockEventsList.mockRejectedValue(apiError(403, 'Rate Limit Exceeded', 'rateLimitExceeded'));

            const res = await probe(superAdminReq());
            expect(res.rows[0].verdict).toBe('rate_limited');
            expect(res.summary.needsOrgActionRows).toBe(0);
            expect(res.summary.inconclusiveVehicles).toBe(1);
        });

        it('설정 오류(서비스 계정 주소·@ 없는 값)는 바인딩·캘린더 조회 전에 가른다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: '1066541065552-compute@developer.gserviceaccount.com', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'https://calendar.google.com/r/month/2026/8/1', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq());

            expect(mockEventsList).not.toHaveBeenCalled();
            expect(mockBindingOwner).not.toHaveBeenCalled();
            expect(res.rows.map(r => r.verdict).sort()).toEqual(['malformed', 'service_account_address']);
        });
    });

    describe('대상 선별·상한', () => {
        it('기본은 실패가 누적된 차량만 본다', async () => {
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

        it('includeHealthy여도 정상 차량이 "리셋만으로 복구" 수를 부풀리지 않는다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'mixed@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 0 }),
                    vehicle('v2', { googleCalendarId: 'mixed@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            const res = await probe(superAdminReq({ includeHealthy: true }));
            expect(res.rows[0].vehicleCount).toBe(2);
            // 실제로 막혀 있는 것은 1대뿐 — 리셋 대상도 1대다
            expect(res.summary.resettableVehicles).toBe(1);
        });

        it('failCount 3~9(쿨다운)는 리셋 대상으로 세지 않는다 — 24h 후 자동 재시도된다', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'cooling@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 5 })],
            });

            const res = await probe(superAdminReq());
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].blockedVehicleCount).toBe(0);
            expect(res.summary.resettableVehicles).toBe(0);
        });
    });

    describe('요약 — 네 갈래가 배타적이다', () => {
        it('오탐(기능 OFF·기관 문서 없음)은 다른 갈래에 중복 계상되지 않는다', async () => {
            orgData.set('o-off', { name: '기능끔기관', status: 'approved', googleCalendarEnabled: false });
            orgData.set('o-gone', null); // 기관 문서 없음
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'off@example.or.kr', organizationId: 'o-off', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'orphan@example.or.kr', organizationId: 'o-gone', calendarSyncFailCount: 10 }),
                ],
            });
            mockEventsList.mockRejectedValue(apiError(404, 'Not Found'));

            const res = await probe(superAdminReq());

            expect(res.summary.falsePositiveVehicles).toBe(2);
            // 예전에는 이 2건이 needsOrgAction에도 함께 들어가 합계가 대상 수를 넘었다
            expect(res.summary.needsOrgActionVehicles).toBe(0);
            expect(res.summary.resettableVehicles).toBe(0);
            expect(res.summary.inconclusiveVehicles).toBe(0);
        });

        it('네 갈래의 합이 영구중단 차량 수와 정확히 같다', async () => {
            orgData.set('o-off', { name: '기능끔', status: 'approved', googleCalendarEnabled: false });
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'live@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'dead@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v3', { googleCalendarId: 'busy@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v4', { googleCalendarId: 'off@example.or.kr', organizationId: 'o-off', calendarSyncFailCount: 10 }),
                ],
            });
            mockEventsList.mockImplementation((args: { calendarId: string }) => {
                if (args.calendarId === 'dead@example.or.kr') return Promise.reject(apiError(404, 'Not Found'));
                if (args.calendarId === 'busy@example.or.kr') return Promise.reject(apiError(403, 'quota exceeded'));
                if (args.calendarId === 'off@example.or.kr') return Promise.reject(apiError(404, 'Not Found'));
                return Promise.resolve({ data: { items: [] } });
            });

            const res = await probe(superAdminReq());

            const sum = (res.summary.resettableVehicles as number)
                + (res.summary.needsOrgActionVehicles as number)
                + (res.summary.inconclusiveVehicles as number)
                + (res.summary.falsePositiveVehicles as number);
            expect(sum).toBe(res.summary.blockedVehicles);
            expect(sum).toBe(4);
        });

        it("기관 상태 'pending'은 오탐으로 접지 않는다 — 동기화 경로에 status 게이트가 없다", async () => {
            orgData.set('o-pending', { name: '대기기관', status: 'pending' });
            mockVehiclesGet.mockResolvedValue({
                docs: [vehicle('v1', { googleCalendarId: 'p@example.or.kr', organizationId: 'o-pending', calendarSyncFailCount: 10 })],
            });
            mockEventsList.mockRejectedValue(apiError(403, 'Forbidden'));

            const res = await probe(superAdminReq());

            expect(res.summary.falsePositiveVehicles).toBe(0);
            expect(res.summary.needsOrgActionVehicles).toBe(1);
        });

        it('기관 문서는 한 번에 읽는다 (순차 왕복이 타임아웃 여유를 갉아먹지 않게)', async () => {
            mockVehiclesGet.mockResolvedValue({
                docs: [
                    vehicle('v1', { googleCalendarId: 'a@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                    vehicle('v2', { googleCalendarId: 'b@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 10 }),
                ],
            });

            await probe(superAdminReq());
            expect(mockGetAll).toHaveBeenCalledTimes(1);
        });
    });

    describe('상한 절단', () => {
        it('심각한 것부터 남기고 자른다 (문서 순서대로 자르지 않는다)', async () => {
            // MAX_TARGETS(300)를 넘기지 않고도 정렬 자체를 검증한다: 결과 정렬이 아니라
            // '무엇이 진단 대상에 들어가는가'가 실패 횟수 순인지 본다.
            const docs = [
                vehicle('v1', { googleCalendarId: 'low@example.or.kr', organizationId: 'o1', calendarSyncFailCount: 3 }),
                vehicle('v2', { googleCalendarId: 'high@example.or.kr', organizationId: 'o1', calendarSyncFailCount: MAX_FAIL_COUNT }),
            ];
            mockVehiclesGet.mockResolvedValue({ docs });

            const res = await probe(superAdminReq());
            expect(res.summary.truncated).toBe(false);
            expect(res.summary.totalRows).toBe(2);
            // 정렬 결과: 실패가 큰 쪽이 먼저 진단 대상에 들어간다
            const calls = mockEventsList.mock.calls.map((c) => (c[0] as { calendarId: string }).calendarId);
            expect(calls[0]).toBe('high@example.or.kr');
        });
    });
});
