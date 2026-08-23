/**
 * calendarBinding.test.ts — 캘린더 ID ↔ 기관 바인딩 (2026-08-23 감사 발견 1)
 *
 * 고정하는 것: **다른 기관에 귀속된 캘린더 ID로는 동기화가 열리지 않는다.**
 * 이 검사가 없으면 관리자가 적어 넣은 남의 캘린더 ID로 그 기관의 일정이 우리 예약으로
 * 유입되고(정보 유출), 우리가 그 예약을 지우면 원본 일정이 지워졌다(무결성 파괴).
 *
 * 함께 고정하는 것:
 *  - 미등록 ID는 선점 등록되고, 경합에서 뒤늦은 쪽이 남의 바인딩을 덮지 않는다.
 *  - 판정 불가(조회 실패)는 열지 않는다(fail-closed) — 장애가 유출 창구가 되면 안 된다.
 *  - 진단용 조회(getCalendarBindingOwner)는 **선점하지 않는다** — 진단이 선점하면
 *    아직 동기화를 돌리지 않은 기관의 ID를 남이 버튼으로 차지할 수 있다.
 */

const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet, create: mockCreate }));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: () => ({ doc: mockDoc }) }),
    FieldValue: { serverTimestamp: () => 'ts' },
}));

import {
    isCalendarBoundToOrg,
    getCalendarBindingOwner,
    calendarBindingKey,
    normalizeCalendarId,
    type CalendarBindingCache,
} from '../services/calendar/calendarBinding';

/** 바인딩 문서 스냅샷 */
function bindingSnap(organizationId: string) {
    return { exists: true, data: () => ({ organizationId }) };
}
const MISSING = { exists: false, data: () => undefined };

describe('calendarBindingKey / normalizeCalendarId', () => {
    it('공백·대소문자 차이는 같은 바인딩으로 본다', () => {
        expect(normalizeCalendarId('  Car@Group.Calendar.Google.com ')).toBe('car@group.calendar.google.com');
        expect(calendarBindingKey('  Car@Group.Calendar.Google.com '))
            .toBe(calendarBindingKey('car@group.calendar.google.com'));
    });

    it('문서 ID로 쓸 수 있는 형태다 — 캘린더 ID의 @·.이 그대로 새지 않는다', () => {
        const key = calendarBindingKey('vehicle@example.or.kr');
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('isCalendarBoundToOrg', () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockCreate.mockReset();
    });

    it('다른 기관에 귀속된 캘린더는 거절한다 — 이 앱의 유출 차단선', async () => {
        mockGet.mockResolvedValue(bindingSnap('victim-org'));
        await expect(
            isCalendarBoundToOrg('victim@group.calendar.google.com', 'attacker-org', { logName: 't' })
        ).resolves.toBe(false);
        // 선점 시도조차 하지 않는다 (남의 바인딩을 건드리지 않는다)
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('자기 기관에 귀속된 캘린더는 통과한다', async () => {
        mockGet.mockResolvedValue(bindingSnap('my-org'));
        await expect(
            isCalendarBoundToOrg('mine@group.calendar.google.com', 'my-org', { logName: 't' })
        ).resolves.toBe(true);
    });

    it('미등록 캘린더는 호출 기관으로 선점 등록한다', async () => {
        mockGet.mockResolvedValue(MISSING);
        mockCreate.mockResolvedValue(undefined);

        await expect(
            isCalendarBoundToOrg('new@group.calendar.google.com', 'my-org', { logName: 't' })
        ).resolves.toBe(true);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0]).toMatchObject({
            calendarId: 'new@group.calendar.google.com',
            organizationId: 'my-org',
        });
    });

    it('등록 경합에서 늦은 쪽은 남의 바인딩을 덮지 않고 거절된다', async () => {
        // 읽을 때는 없었지만, create 사이에 다른 기관이 먼저 만들었다
        mockGet.mockResolvedValueOnce(MISSING).mockResolvedValueOnce(bindingSnap('other-org'));
        mockCreate.mockRejectedValue(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));

        await expect(
            isCalendarBoundToOrg('race@group.calendar.google.com', 'late-org', { logName: 't' })
        ).resolves.toBe(false);
    });

    it('조회가 실패하면 열지 않는다 (fail-closed)', async () => {
        mockGet.mockRejectedValue(new Error('Firestore unavailable'));
        await expect(
            isCalendarBoundToOrg('x@group.calendar.google.com', 'my-org', { logName: 't' })
        ).resolves.toBe(false);
    });

    it('캘린더 ID나 기관 ID가 없으면 읽지 않고 바로 거절한다', async () => {
        await expect(isCalendarBoundToOrg(undefined, 'my-org', { logName: 't' })).resolves.toBe(false);
        await expect(isCalendarBoundToOrg('a@b.com', undefined, { logName: 't' })).resolves.toBe(false);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('같은 캐시를 넘기면 같은 바인딩 문서를 한 번만 읽는다', async () => {
        mockGet.mockResolvedValue(bindingSnap('my-org'));
        const cache: CalendarBindingCache = new Map();

        // 한 기관이 차량 4대에 같은 캘린더를 쓰는 흔한 상황
        for (let i = 0; i < 4; i++) {
            await expect(
                isCalendarBoundToOrg('mine@group.calendar.google.com', 'my-org', { logName: 't', cache })
            ).resolves.toBe(true);
        }
        expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('캐시를 써도 기관별 판정은 섞이지 않는다', async () => {
        mockGet.mockResolvedValue(bindingSnap('org-a'));
        const cache: CalendarBindingCache = new Map();
        const id = 'shared@group.calendar.google.com';

        await expect(isCalendarBoundToOrg(id, 'org-a', { logName: 't', cache })).resolves.toBe(true);
        await expect(isCalendarBoundToOrg(id, 'org-b', { logName: 't', cache })).resolves.toBe(false);
    });
});

describe('getCalendarBindingOwner', () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockCreate.mockReset();
    });

    it('소유 기관을 읽어 주지만 선점하지는 않는다', async () => {
        mockGet.mockResolvedValue(bindingSnap('owner-org'));
        await expect(getCalendarBindingOwner('a@group.calendar.google.com')).resolves.toBe('owner-org');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('미등록이면 null이고, 그래도 선점하지 않는다', async () => {
        mockGet.mockResolvedValue(MISSING);
        await expect(getCalendarBindingOwner('b@group.calendar.google.com')).resolves.toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
