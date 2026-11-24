/**
 * calendarFindMatchingEvent.test.ts — 누락 보충 전 중복 확인(findMatchingCalendarEventId)
 * - 지키는 것: 예약 시간대만 조회, 앱이 만들었을 제목·시작·종료가 모두 같을 때만 같은 일정으로 본다,
 *   취소된 일정·다른 제목·다른 시각은 무시, 시각 형식이 깨진 예약은 조회하지 않는다
 */

const mockList = jest.fn();
jest.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth: function GoogleAuth() { /* ADC */ } },
        calendar: () => ({ events: { list: (...a: unknown[]) => mockList(...a) } }),
    },
}));

import { findMatchingCalendarEventId } from '../services/calendar/calendarSync';

const CAL = 'c_abc@resource.calendar.google.com';
const r = { date: '2026-11-30', startTime: '09:00', endTime: '10:30', vehicleName: '스파크', reservedByName: '홍길동', destination: '구청' };
const SUMMARY = '[스파크] 구청 — 홍길동';
const ev = (over: Record<string, unknown> = {}) => ({
    id: 'ev1',
    status: 'confirmed',
    summary: SUMMARY,
    start: { dateTime: '2026-11-30T09:00:00+09:00' },
    end: { dateTime: '2026-11-30T10:30:00+09:00' },
    ...over,
});

beforeEach(() => jest.clearAllMocks());

it('예약 시간대(KST)만 조회한다', async () => {
    mockList.mockResolvedValue({ data: { items: [] } });
    await findMatchingCalendarEventId(CAL, r);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        calendarId: CAL,
        timeMin: '2026-11-30T00:00:00.000Z',
        timeMax: '2026-11-30T01:30:00.000Z',
        singleEvents: true,
    }));
});

it('제목·시작·종료가 모두 같으면 그 일정 ID를 돌려준다 — 시간대 표기가 달라도 같은 시각이면 같다', async () => {
    mockList.mockResolvedValue({ data: { items: [ev({ start: { dateTime: '2026-11-30T00:00:00Z' } })] } });
    await expect(findMatchingCalendarEventId(CAL, r)).resolves.toBe('ev1');
});

it.each([
    ['제목이 다르면', { summary: '[스파크] 다른 일정' }],
    ['종료 시각이 다르면', { end: { dateTime: '2026-11-30T11:00:00+09:00' } }],
    ['취소된 일정이면', { status: 'cancelled' }],
])('%s 같은 일정이 아니다', async (_l, over) => {
    mockList.mockResolvedValue({ data: { items: [ev(over)] } });
    await expect(findMatchingCalendarEventId(CAL, r)).resolves.toBeNull();
});

it('시각 형식이 깨진 예약은 조회하지 않고 null', async () => {
    await expect(findMatchingCalendarEventId(CAL, { ...r, startTime: '' })).resolves.toBeNull();
    expect(mockList).not.toHaveBeenCalled();
});
