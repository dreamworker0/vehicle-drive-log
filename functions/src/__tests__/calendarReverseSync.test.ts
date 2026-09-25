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
const mockCalendarBindingGet = jest.fn();
const mockCalendarBindingCreate = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'users') {
                return { doc: () => ({ get: mockUserProfileGet }) };
            }
            if (name === 'organizations') {
                return { doc: () => ({ get: mockOrganizationGet }) };
            }
            if (name === 'calendarBindings') {
                return { doc: () => ({ get: mockCalendarBindingGet, create: mockCalendarBindingCreate }) };
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
import { syncSingleVehicleCalendar, computeCalendarFingerprint } from '../handlers/scheduled/calendarSchedule';
import { getKSTDateString } from '../utils/kstDate';

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
        // 차량 이름 후보를 함께 넘겨도 그와 다른 제목은 그대로 목적지가 된다
        // (차량명 판정이 자유형식 파싱 전체를 죽이지 않는다는 뜻이다).
        const parsed = parseEventToReservation(
            makeEvent({ summary: '합정역' }) as never,
            'veh-1', '스타렉스8888', 'org-1', VEHICLE
        );
        expect(parsed.destination).toBe('합정역');
        expect(parsed.reservedByName).toBe('');
        expect(parsed.syncSource).toBe('calendar');
        expect(parsed.calendarEventId).toBe('evt-1');
        expect(parsed.status).toBe('reserved');
    });

    /**
     * 사람이 구글 캘린더에 제목을 차량 이름만 적는 일이 잦다("스파크", "레이"). 그대로 두면
     * 목적지가 차량명이 되고, 그 예약으로 연 운행일지가 고쳐지지 않은 채 저장돼 **공식 기록
     * (PDF·Excel)에 차량명이 목적지로 남는다.** 2026-09-15 이용 기관 신고.
     */
    it('제목이 차량 표시 이름뿐이면 목적지로 쓰지 않는다', () => {
        const parsed = parseEventToReservation(
            makeEvent({ summary: '스타렉스8888' }) as never,
            'veh-1', '스타렉스8888', 'org-1', VEHICLE
        );
        expect(parsed.destination).toBe('');
    });

    it('차량번호·본래 이름도 같게 본다 (공백·대소문자 무시)', () => {
        const aliases = { displayName: '레이', name: 'Ray', plateNumber: '12가 3456' };

        expect(parseEventToReservation(
            makeEvent({ summary: ' 레이 ' }) as never, 'veh-1', '레이', 'org-1', aliases
        ).destination).toBe('');

        expect(parseEventToReservation(
            makeEvent({ summary: 'ray' }) as never, 'veh-1', '레이', 'org-1', aliases
        ).destination).toBe('');

        expect(parseEventToReservation(
            makeEvent({ summary: '12가3456' }) as never, 'veh-1', '레이', 'org-1', aliases
        ).destination).toBe('');
    });

    it('차량명으로 시작할 뿐인 진짜 목적지는 남긴다 — 완전 일치만 본다', () => {
        // 부분 일치로 거르면 "스파크 정비소"라는 실제 행선지가 함께 죽는다.
        const parsed = parseEventToReservation(
            makeEvent({ summary: '스타렉스8888 정비소' }) as never,
            'veh-1', '스타렉스8888', 'org-1', VEHICLE
        );
        expect(parsed.destination).toBe('스타렉스8888 정비소');
    });

    it('설명란 [목적지:]에 적힌 값은 차량명이어도 그대로 둔다 — 그 칸은 일부러 적은 것이다', () => {
        const parsed = parseEventToReservation(
            makeEvent({ summary: '아무 제목', description: '목적지: 스타렉스8888' }) as never,
            'veh-1', '스타렉스8888', 'org-1', VEHICLE
        );
        expect(parsed.destination).toBe('스타렉스8888');
    });

    it('비교할 차량 이름을 넘기지 않으면 판정하지 않는다 (종전 동작 유지)', () => {
        const parsed = parseEventToReservation(
            makeEvent({ summary: '스타렉스8888' }) as never,
            'veh-1', '스타렉스8888', 'org-1'
        );
        expect(parsed.destination).toBe('스타렉스8888');
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
        // 캘린더는 이 차량의 기관에 귀속돼 있다 (정상 경로)
        mockCalendarBindingGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org-1' }) });
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

    it('다른 기관에 귀속된 캘린더면 이벤트 조회조차 하지 않는다 (2026-08-23 감사 발견 1)', async () => {
        // 관리자가 차량에 남의 캘린더 ID를 적어 넣은 상황. 이 검사가 없으면 그 기관의
        // 일정이 우리 예약으로 저장된다(정보 유출) — 유입 지점에서 끊는다.
        mockCalendarBindingGet.mockResolvedValue({
            exists: true,
            data: () => ({ organizationId: 'victim-org' }),
        });

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result).toEqual({ created: 0, updated: 0, cancelled: 0, skippedDup: 0, reads: 0, skippedUnchanged: false });
        // 캘린더 API 호출 자체가 없어야 한다 (요청을 보내면 이미 늦다)
        expect(mockListCalendarEvents).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('바인딩 조회가 실패하면 동기화하지 않는다 (fail-closed)', async () => {
        mockCalendarBindingGet.mockRejectedValue(new Error('Firestore unavailable'));

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result).toEqual({ created: 0, updated: 0, cancelled: 0, skippedDup: 0, reads: 0, skippedUnchanged: false });
        expect(mockListCalendarEvents).not.toHaveBeenCalled();
    });

    it('기관이 Google 캘린더 기능을 끄면 역동기화를 시작하지 않는다', async () => {
        mockOrganizationGet.mockResolvedValue({
            exists: true,
            data: () => ({ googleCalendarEnabled: false }),
        });

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result).toEqual({ created: 0, updated: 0, cancelled: 0, skippedDup: 0, reads: 0, skippedUnchanged: false });
        expect(mockListCalendarEvents).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
    });
});

/**
 * 역동기화는 하루 34회 × 차량마다 9일치 예약을 다시 읽어 하루 읽기의 대부분을 차지했다
 * (2026-09-25, 무료 한도 5만/일 중 3.7만). 캘린더가 그대로면 예약 조회부터 건너뛴다.
 */
describe('computeCalendarFingerprint', () => {
    const TODAY = '2026-09-25';

    it('이벤트 순서가 달라도 같은 지문을 낸다', () => {
        const a = makeEvent({ id: 'a' });
        const b = makeEvent({ id: 'b' });
        expect(computeCalendarFingerprint([a, b], VEHICLE, TODAY))
            .toBe(computeCalendarFingerprint([b, a], VEHICLE, TODAY));
    });

    it('이벤트 수정 시각·상태가 바뀌면 지문이 달라진다', () => {
        const base = computeCalendarFingerprint([makeEvent()], VEHICLE, TODAY);
        expect(computeCalendarFingerprint([makeEvent({ updated: '2026-07-12T11:00:00Z' })], VEHICLE, TODAY)).not.toBe(base);
        expect(computeCalendarFingerprint([makeEvent({ status: 'cancelled' })], VEHICLE, TODAY)).not.toBe(base);
        expect(computeCalendarFingerprint([], VEHICLE, TODAY)).not.toBe(base);
    });

    it('날짜가 바뀌면 지문이 달라진다 — 하루 한 번은 전체 동기화된다', () => {
        expect(computeCalendarFingerprint([makeEvent()], VEHICLE, '2026-09-26'))
            .not.toBe(computeCalendarFingerprint([makeEvent()], VEHICLE, TODAY));
    });

    it('파서가 쓰는 차량 필드가 바뀌면 지문이 달라진다', () => {
        const base = computeCalendarFingerprint([makeEvent()], VEHICLE, TODAY);
        expect(computeCalendarFingerprint([makeEvent()], { ...VEHICLE, displayName: '레이' }, TODAY)).not.toBe(base);
        expect(computeCalendarFingerprint([makeEvent()], { ...VEHICLE, plateNumber: '12가3456' }, TODAY)).not.toBe(base);
        expect(computeCalendarFingerprint([makeEvent()], { ...VEHICLE, googleCalendarId: 'other@group.calendar.google.com' }, TODAY)).not.toBe(base);
    });
});

describe('syncSingleVehicleCalendar — 변경 없는 캘린더 건너뛰기', () => {
    const currentFingerprint = () =>
        computeCalendarFingerprint([makeEvent()], VEHICLE, getKSTDateString(new Date()));

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        mockReservationsQueryGet.mockResolvedValue({ docs: [], empty: true });
        mockDoubleCheckGet.mockResolvedValue({ docs: [], empty: true });
        mockListCalendarEvents.mockResolvedValue([makeEvent()]);
        mockOrganizationGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockCalendarBindingGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org-1' }) });
        mockGetUserByEmail.mockResolvedValue({ uid: 'uid-1', displayName: '김직원' });
    });
    afterEach(() => jest.restoreAllMocks());

    it('지문이 직전과 같으면 예약을 읽지도 쓰지도 않는다', async () => {
        const vehicle = { ...VEHICLE, calendarSyncFingerprint: currentFingerprint() };

        const result = await syncSingleVehicleCalendar('veh-1', vehicle, new Set(), undefined, undefined, { skipIfUnchanged: true });

        expect(result).toEqual({ created: 0, updated: 0, cancelled: 0, skippedDup: 0, reads: 0, skippedUnchanged: true });
        expect(mockReservationsQueryGet).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('지문이 다르면 전체 동기화하고 새 지문을 차량 문서에 남긴다', async () => {
        const vehicle = { ...VEHICLE, calendarSyncFingerprint: 'stale' };

        const result = await syncSingleVehicleCalendar('veh-1', vehicle, new Set(), undefined, undefined, { skipIfUnchanged: true });

        expect(result.skippedUnchanged).toBe(false);
        expect(result.created).toBe(1);
        expect(mockReservationsQueryGet).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith({ calendarSyncFingerprint: currentFingerprint() });
    });

    it('온디맨드 호출(옵션 없음)은 지문이 같아도 항상 전체 동기화한다', async () => {
        const vehicle = { ...VEHICLE, calendarSyncFingerprint: currentFingerprint() };

        const result = await syncSingleVehicleCalendar('veh-1', vehicle);

        expect(result.skippedUnchanged).toBe(false);
        expect(mockReservationsQueryGet).toHaveBeenCalledTimes(1);
        // 지문이 그대로라 다시 쓰지 않는다
        expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFingerprint: expect.anything() }));
    });

    it('중간에 실패하면 지문을 남기지 않는다 — 다음 주기가 다시 전체로 돈다', async () => {
        mockSet.mockRejectedValueOnce(new Error('write failed'));

        await expect(syncSingleVehicleCalendar('veh-1', VEHICLE, new Set(), undefined, undefined, { skipIfUnchanged: true }))
            .rejects.toThrow('write failed');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('빈 결과 쿼리도 1건으로 세어 읽기 수를 집계한다', async () => {
        // 기간 쿼리(빈 결과 1) + 더블체크(빈 결과 1) + 프로필 조회(1)
        mockGetUserByEmail.mockResolvedValue({ uid: 'uid-1', displayName: undefined });
        mockUserProfileGet.mockResolvedValue({ exists: true, data: () => ({ name: '프로필이름' }) });

        const result = await syncSingleVehicleCalendar('veh-1', VEHICLE);

        expect(result.reads).toBe(3);
    });
});
