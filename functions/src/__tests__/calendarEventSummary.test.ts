/**
 * 캘린더 이벤트 제목 — 외부 대여는 "누구에게 나갔는가"가 먼저 보여야 한다.
 *
 * 그 기간에 차가 없다는 표시라, 목적지·예약자 형식(`목적지 — 이름`)이면 기관 캘린더를 보는
 * 사람이 직원 운행으로 읽는다.
 */
const mockInsert = jest.fn().mockResolvedValue({ data: { id: 'evt1' } });

jest.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth: jest.fn() },
        calendar: () => ({ events: { insert: mockInsert } }),
    },
}));

import { createCalendarEvent } from '../services/calendar/calendarSync';

describe('createCalendarEvent — 제목', () => {
    beforeEach(() => {
        mockInsert.mockClear();
        jest.spyOn(console, 'log').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const base = { date: '2026-10-20', startTime: '14:00', endTime: '23:59', vehicleName: '스타렉스' };

    it('외부 대여는 [차량] 외부 대여 · 기관명', async () => {
        await createCalendarEvent('cal1', {
            ...base,
            destination: '부산',
            reservedByName: '(외부) 동산 사회복지관 홍길동',
            externalLoan: { borrowerOrg: '동산 사회복지관', driverName: '홍길동' },
        });

        expect(mockInsert.mock.calls[0][0].requestBody.summary).toBe('[스타렉스] 외부 대여 · 동산 사회복지관');
    });

    it('일반 예약은 그대로 [차량] 목적지 — 예약자', async () => {
        await createCalendarEvent('cal1', { ...base, destination: '부산', reservedByName: '김철수' });

        expect(mockInsert.mock.calls[0][0].requestBody.summary).toBe('[스타렉스] 부산 — 김철수');
    });
});
