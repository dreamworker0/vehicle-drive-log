/**
 * calendarReverseSync.test.ts — 캘린더 → 앱 역동기화 회귀 테스트
 *
 * parseEventToReservation(제목/설명 파싱)과 syncSingleVehicleCalendar의
 * 예약자(reservedByName) 폴백 체인(Auth displayName → Firestore 프로필 name →
 * 이메일 로컬파트)을 검증한다. 자유형식 제목(예: "합정역")으로 등록해도
 * 예약이 "예약자 미상"으로 남지 않는 것이 목적.
 */

// ── Firestore mock ──
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockReservationsQueryGet = jest.fn();
const mockDoubleCheckGet = jest.fn();
const mockUserProfileGet = jest.fn();
const mockOrganizationGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'users') {
                return { doc: () => ({ get: mockUserProfileGet }) };
            }
            if (name === 'organizations') {
                return { doc: () => ({ get: mockOrganizationGet }) };
            }
            // reservations: 기간 쿼리(3중 where) / 더블체크(where+limit) / doc().set·update
            const q: Record<string, unknown> = { _limited: false };
            q.where = () => q;
            q.limit = () => { q._limited = true; return q; };
            q.get = async () => (q._limited ? mockDoubleCheckGet() : mockReservationsQueryGet());
            q.doc = () => ({ set: mockSet, update: mockUpdate });
            return q;
        },
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

// ── Auth mock ──
const mockGetUserByEmail = jest.fn();
jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({ getUserByEmail: mockGetUserByEmail }),
}));

// ── 스케줄러/부가 모듈 mock ──
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock('../core/discord', () => ({ sendDiscordAlert: jest.fn() }));
jest.mock('../utils/helpers', () => ({ recordHeartbeat: jest.fn() }));

// ── calendarSync 부분 mock: 파서는 실물, 이벤트 목록만 mock ──
const mockListCalendarEvents = jest.fn();
jest.mock('../services/calendar/calendarSync', () => {
    const actual = jest.requireActual('../services/calendar/calendarSync');
    return {
        ...actual,
        listCalendarEvents: (...args: unknown[]) => mockListCalendarEvents(...args),
    };
});

import { parseEventToReservation } from '../services/calendar/calendarSync';
import { syncSingleVehicleCalendar } from '../handlers/scheduled/calendarSchedule';

// ── 픽스처 ──
const makeEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'evt-1',
    summary: '합정역',
    description: '',
    start: { dateTime: '2026-07-13T11:30:00+09:00' },
    end: { dateTime: '2026-07-13T13:00:00+09:00' },
    status: 'confirmed',
    updated: '2026-07-12T10:00:00Z',
    creator: { email: 'staff@example.org' },
    ...overrides,
});

const VEHICLE = {
    googleCalendarId: 'vehicle-cal@group.calendar.google.com',
    displayName: '스타렉스8888',
    organizationId: 'org-1',
};

describe('parseEventToReservation (제목/설명 파싱)', () => {
    it('표준 형식 "[차량명] 목적지 — 예약자" 제목을 파싱한다', () => {
        const parsed = parseEventToReservation(
            makeEvent({ summary: '[스타렉스8888] 서울역 — 김종원' }) as never,
            'veh-1', '스타렉스8888', 'org-1'
        );
        expect(parsed.destination).toBe('서울역');
        expect(parsed.reservedByName).toBe('김종원');
        expect(parsed.date).toBe('2026-07-13');
        expect(parsed.startTime).toBe('11:30');
        expect(parsed.endTime).toBe('13:00');
    });

    it('description의 "예약자:/용도:/목적지:" 라인이 제목보다 우선한다', () => {
        const parsed = parseEventToReservation(
            makeEvent({
                summary: '아무 제목',
                description: '예약자: 홍길동\n용도: 업무\n목적지: 시청',
            }) as never,
            'veh-1', '스타렉스8888', 'org-1'
        );
        expect(parsed.reservedByName).toBe('홍길동');
        expect(parsed.purpose).toBe('업무');
        expect(parsed.destination).toBe('시청');
    });

    it('자유형식 제목(구분자 없음)은 전체를 목적지로 넣고 예약자는 비운다', () => {
        const parsed = parseEventToReservation(
            makeEvent({ summary: '합정역' }) as never,
            'veh-1', '스타렉스8888', 'org-1'
        );
        expect(parsed.destination).toBe('합정역');
        expect(parsed.reservedByName).toBe('');
        expect(parsed.syncSource).toBe('calendar');
        expect(parsed.calendarEventId).toBe('evt-1');
        expect(parsed.status).toBe('reserved');
    });

    it('종일 이벤트(date만 존재)는 09:00~18:00 기본 시간을 채운다', () => {
        const parsed = parseEventToReservation(
            makeEvent({ start: { date: '2026-07-13' }, end: { date: '2026-07-14' } }) as never,
            'veh-1', '스타렉스8888', 'org-1'
        );
        expect(parsed.date).toBe('2026-07-13');
        expect(parsed.startTime).toBe('09:00');
        expect(parsed.endTime).toBe('18:00');
    });
});

describe('syncSingleVehicleCalendar — reservedByName 폴백 체인', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        // 기존 예약 없음 + 더블체크도 비어 있음 → 신규 생성 경로
        mockReservationsQueryGet.mockResolvedValue({ docs: [], empty: true });
        mockDoubleCheckGet.mockResolvedValue({ docs: [], empty: true });
        mockListCalendarEvents.mockResolvedValue([makeEvent()]);
        mockOrganizationGet.mockResolvedValue({ exists: true, data: () => ({}) });
    });
    afterEach(() => jest.restoreAllMocks());

    it('Auth displayName이 있으면 예약자로 사용한다', async () => {
        mockGetUserByEmail.mockResolvedValue({ uid: 'uid-1', displayName: '김직원' });

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result.created).toBe(1);
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            reservedByName: '김직원',
            reservedByUid: 'uid-1',
        }));
    });

    it('displayName이 없으면 Firestore 프로필(users.name)로 폴백한다', async () => {
        mockGetUserByEmail.mockResolvedValue({ uid: 'uid-1', displayName: undefined });
        mockUserProfileGet.mockResolvedValue({ exists: true, data: () => ({ name: '프로필이름' }) });

        await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            reservedByName: '프로필이름',
        }));
    });

    it('앱 미가입 생성자는 이메일 로컬파트로 폴백하고 이메일 전체는 저장하지 않는다', async () => {
        mockGetUserByEmail.mockRejectedValue(new Error('user-not-found'));

        await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            reservedByName: 'staff',
        }));
        const saved = mockSet.mock.calls[0][0];
        expect(saved.creatorEmail).toBeUndefined();
        expect(JSON.stringify(saved)).not.toContain('staff@example.org');
    });

    it('표준 형식 제목이면 폴백 없이 제목의 예약자를 유지한다', async () => {
        mockListCalendarEvents.mockResolvedValue([
            makeEvent({ summary: '[스타렉스8888] 서울역 — 김종원' }),
        ]);
        mockGetUserByEmail.mockResolvedValue({ uid: 'uid-1', displayName: '다른이름' });

        await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            reservedByName: '김종원',
        }));
    });

    it('기관이 Google 캘린더 기능을 끄면 역동기화를 시작하지 않는다', async () => {
        mockOrganizationGet.mockResolvedValue({
            exists: true,
            data: () => ({ googleCalendarEnabled: false }),
        });

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result).toEqual({ created: 0, updated: 0, cancelled: 0, skippedDup: 0 });
        expect(mockListCalendarEvents).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
    });
});
