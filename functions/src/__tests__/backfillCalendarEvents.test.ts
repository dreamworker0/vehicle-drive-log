/**
 * backfillCalendarEvents.test.ts — 메모리 초과(2026-10-25~)로 캘린더에 빠진 예약 일정 보충
 * - 지키는 것: superAdmin만, 기본은 미리 보기(쓰기·캘린더 호출 없음),
 *   앞으로의 날짜·확정 예약·일정 ID 없음만 생성(지난 날짜·승인 대기·역동기화 예약 제외),
 *   같은 일정이 이미 있으면 생성 대신 연결, 취소 예약에 남은 일정은 삭제,
 *   트리거와 같은 차량 기준(다른 기관 차량·실패 누적·기능 꺼짐·바인딩 불일치는 건너뜀),
 *   한 건 실패가 나머지를 멈추지 않음
 */

const mockReservationsGet = jest.fn();
const mockWhere = jest.fn();
const vehicles: Record<string, Record<string, unknown> | undefined> = {};
const mockCreate = jest.fn();
const mockDelete = jest.fn();
const mockFindMatching = jest.fn();
const mockCalendarEnabled = jest.fn();
const mockBound = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    Timestamp: { fromDate: (d: Date) => ({ d }) },
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'reservations') {
                return { where: (...args: unknown[]) => { mockWhere(...args); return { get: mockReservationsGet }; } };
            }
            if (name === 'vehicles') return { doc: (id: string) => ({ get: async () => ({ data: () => vehicles[id] }) }) };
            return { doc: (id: string) => ({ get: async () => ({ data: () => ({ name: `기관-${id}` }) }) }) };
        },
    }),
}));
jest.mock('../utils/kstDate', () => ({ getKSTDateString: () => '2026-11-24' }));
jest.mock('../services/calendar/calendarFeature', () => ({
    isGoogleCalendarEnabled: (...a: unknown[]) => mockCalendarEnabled(...a),
}));
jest.mock('../services/calendar/calendarBinding', () => ({
    isCalendarBoundToOrg: (...a: unknown[]) => mockBound(...a),
}));
jest.mock('../services/calendar/calendarSync', () => ({
    createCalendarEvent: (...a: unknown[]) => mockCreate(...a),
    deleteCalendarEvent: (...a: unknown[]) => mockDelete(...a),
    findMatchingCalendarEventId: (...a: unknown[]) => mockFindMatching(...a),
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

import { backfillCalendarEvents } from '../scripts/backfillCalendarEvents';

type Result = Record<string, unknown> & { orgs: Array<Record<string, unknown>> };
const handler = backfillCalendarEvents as unknown as (req: Record<string, unknown>) => Promise<Result>;
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const CAL = 'c_abc@resource.calendar.google.com';

function resv(id: string, data: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue(undefined);
    return {
        id,
        ref: { update },
        data: () => ({ organizationId: 'org1', vehicleId: 'v1', date: '2026-11-30', startTime: '09:00', endTime: '10:00', ...data }),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const k of Object.keys(vehicles)) delete vehicles[k];
    vehicles.v1 = { organizationId: 'org1', googleCalendarId: CAL, calendarSyncFailCount: 0 };
    mockCalendarEnabled.mockResolvedValue(true);
    mockBound.mockResolvedValue(true);
    mockFindMatching.mockResolvedValue(null);
    mockCreate.mockResolvedValue('ev-new');
    mockDelete.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('backfillCalendarEvents — 권한·입력', () => {
    it('superAdmin이 아니면 거부한다', async () => {
        await expect(handler({ auth: { uid: 'a', token: { role: 'admin' } }, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockReservationsGet).not.toHaveBeenCalled();
    });

    it('since 형식이 틀리면 거부한다', async () => {
        await expect(handler({ auth: superAdmin, data: { since: '10/25' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('기본 시작일은 메모리 초과가 처음 난 2026-10-25(KST 0시)다', async () => {
        mockReservationsGet.mockResolvedValue({ docs: [] });
        await handler({ auth: superAdmin, data: {} });
        expect(mockWhere).toHaveBeenCalledWith('createdAt', '>=', { d: new Date('2026-10-25T00:00:00+09:00') });
    });
});

describe('backfillCalendarEvents — 대상 고르기', () => {
    it('기본은 미리 보기 — 건수만 세고 캘린더도 문서도 건드리지 않는다', async () => {
        const a = resv('r1', { status: 'reserved' });
        const b = resv('r2', { status: 'cancelled', calendarEventId: 'ev-old' });
        mockReservationsGet.mockResolvedValue({ docs: [a, b] });

        const res = await handler({ auth: superAdmin, data: {} });

        expect(res).toMatchObject({ dryRun: true, toCreate: 1, toDelete: 1, created: 0, deleted: 0 });
        expect(res.orgs[0]).toMatchObject({ orgName: '기관-org1', toCreate: 1, toDelete: 1 });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockFindMatching).not.toHaveBeenCalled();
        expect(a.ref.update).not.toHaveBeenCalled();
    });

    it('지난 날짜·승인 대기·역동기화·이미 일정 있는 예약·일정 없는 취소 예약은 대상이 아니다', async () => {
        mockReservationsGet.mockResolvedValue({ docs: [
            resv('past', { status: 'reserved', date: '2026-11-23' }),
            resv('pending', { status: 'pending' }),
            resv('reverse', { status: 'reserved', syncSource: 'calendar' }),
            resv('hasEvent', { status: 'reserved', calendarEventId: 'ev1' }),
            resv('cancelNoEvent', { status: 'cancelled' }),
        ] });
        const res = await handler({ auth: superAdmin, data: { dryRun: false } });
        expect(res).toMatchObject({ toCreate: 0, toDelete: 0, created: 0, deleted: 0 });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('오늘 날짜 예약은 대상이다', async () => {
        mockReservationsGet.mockResolvedValue({ docs: [resv('today', { status: 'reserved', date: '2026-11-24' })] });
        const res = await handler({ auth: superAdmin, data: { dryRun: false } });
        expect(res).toMatchObject({ created: 1 });
    });

    it.each([
        ['다른 기관 차량', () => { vehicles.v1 = { organizationId: 'org2', googleCalendarId: CAL }; }],
        ['캘린더 ID 없음', () => { vehicles.v1 = { organizationId: 'org1', googleCalendarId: '' }; }],
        ['실패 누적(쿨다운)', () => { vehicles.v1 = { organizationId: 'org1', googleCalendarId: CAL, calendarSyncFailCount: 3, calendarSyncLastFailAt: { toDate: () => new Date() } }; }],
        ['기관 연동 꺼짐', () => { mockCalendarEnabled.mockResolvedValue(false); }],
        ['바인딩 불일치', () => { mockBound.mockResolvedValue(false); }],
    ])('%s 차량은 캘린더를 부르지 않고 건너뜀으로 센다', async (_label, setup) => {
        setup();
        mockReservationsGet.mockResolvedValue({ docs: [resv('r1', { status: 'reserved' })] });
        const res = await handler({ auth: superAdmin, data: { dryRun: false } });
        expect(res).toMatchObject({ toCreate: 0, skippedVehicle: 1, created: 0 });
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('backfillCalendarEvents — 실행', () => {
    it('빠진 일정을 만들고 예약에 일정 ID를 저장한다', async () => {
        const a = resv('r1', { status: 'reserved', vehicleName: '스파크' });
        mockReservationsGet.mockResolvedValue({ docs: [a] });

        const res = await handler({ auth: superAdmin, data: { dryRun: false } });

        expect(mockFindMatching).toHaveBeenCalledWith(CAL, expect.objectContaining({ date: '2026-11-30', vehicleName: '스파크' }));
        expect(mockCreate).toHaveBeenCalledWith(CAL, expect.objectContaining({ date: '2026-11-30' }));
        expect(a.ref.update).toHaveBeenCalledWith({ calendarEventId: 'ev-new' });
        expect(res).toMatchObject({ dryRun: false, created: 1, linked: 0, failed: 0 });
    });

    it('같은 일정이 이미 있으면 새로 만들지 않고 연결만 한다', async () => {
        const a = resv('r1', { status: 'reserved' });
        mockReservationsGet.mockResolvedValue({ docs: [a] });
        mockFindMatching.mockResolvedValue('ev-existing');

        const res = await handler({ auth: superAdmin, data: { dryRun: false } });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(a.ref.update).toHaveBeenCalledWith({ calendarEventId: 'ev-existing' });
        expect(res).toMatchObject({ created: 0, linked: 1 });
    });

    it('취소 예약에 남은 일정은 지운다', async () => {
        mockReservationsGet.mockResolvedValue({ docs: [resv('r2', { status: 'cancelled', calendarEventId: 'ev-old' })] });
        const res = await handler({ auth: superAdmin, data: { dryRun: false } });
        expect(mockDelete).toHaveBeenCalledWith(CAL, 'ev-old');
        expect(res).toMatchObject({ deleted: 1 });
    });

    it('한 건이 실패해도 나머지를 계속 처리하고 실패 수를 센다', async () => {
        const a = resv('r1', { status: 'reserved' });
        const b = resv('r2', { status: 'reserved' });
        mockReservationsGet.mockResolvedValue({ docs: [a, b] });
        mockCreate.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { code: 403 })).mockResolvedValueOnce('ev-2');

        const res = await handler({ auth: superAdmin, data: { dryRun: false } });

        expect(a.ref.update).not.toHaveBeenCalled();
        expect(b.ref.update).toHaveBeenCalledWith({ calendarEventId: 'ev-2' });
        expect(res).toMatchObject({ created: 1, failed: 1 });
    });

    it('차량 판정은 한 번만 한다 — 같은 차량 예약이 여러 건이어도 차량 문서·바인딩을 다시 보지 않는다', async () => {
        mockReservationsGet.mockResolvedValue({ docs: [resv('r1', { status: 'reserved' }), resv('r2', { status: 'reserved' })] });
        await handler({ auth: superAdmin, data: { dryRun: false } });
        expect(mockBound).toHaveBeenCalledTimes(1);
    });
});
