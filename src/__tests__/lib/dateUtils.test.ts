import { describe, it, expect } from 'vitest';
import { toLocalDateStr, toLocalMonthStr } from '../../lib/dateUtils';

describe('dateUtils', () => {
    describe('toLocalDateStr', () => {
        it('Date 객체를 YYYY-MM-DD 형식으로 변환한다', () => {
            const date = new Date(2026, 1, 24); // 2026-02-24
            expect(toLocalDateStr(date)).toBe('2026-02-24');
        });

        it('월/일이 한 자리여도 0-패딩한다', () => {
            const date = new Date(2026, 0, 5); // 2026-01-05
            expect(toLocalDateStr(date)).toBe('2026-01-05');
        });

        it('인자 없이 호출하면 오늘 날짜를 반환한다', () => {
            const result = toLocalDateStr();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('toLocalMonthStr', () => {
        it('Date 객체를 YYYY-MM 형식으로 변환한다', () => {
            const date = new Date(2026, 11, 1); // 2026-12-01
            expect(toLocalMonthStr(date)).toBe('2026-12');
        });

        it('월이 한 자리여도 0-패딩한다', () => {
            const date = new Date(2026, 2, 15); // 2026-03-15
            expect(toLocalMonthStr(date)).toBe('2026-03');
        });
    });
});
