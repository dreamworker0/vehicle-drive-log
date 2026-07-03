import { describe, it, expect } from 'vitest';
import { 
    toLocalDateStr, 
    toLocalMonthStr, 
    formatTimestamp, 
    formatTimestampShort, 
    formatTimestampTime, 
    formatTimestampFull, 
    formatDateKr 
} from '../../lib/dateUtils';

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

    describe('formatTimestamp', () => {
        it('정상적인 TimestampLike 객체를 ko-KR 형식의 M월 D일(요일)로 변환한다', () => {
            const mockTimestamp = { toDate: () => new Date(2026, 4, 5) }; // 2026년 5월 5일 (화)
            const result = formatTimestamp(mockTimestamp);
            expect(result).toContain('5월 5일');
            expect(result).toContain('화');
        });

        it('toDate 함수가 없는 잘못된 값은 "-"를 반환한다', () => {
            expect(formatTimestamp(null)).toBe('-');
            expect(formatTimestamp(undefined)).toBe('-');
            expect(formatTimestamp('2026-05-05')).toBe('-');
            expect(formatTimestamp({})).toBe('-');
        });
    });

    describe('formatTimestampShort', () => {
        it('정상적인 TimestampLike 객체를 축약 형식인 M/D(요일)로 변환한다', () => {
            const mockTimestamp = { toDate: () => new Date(2026, 4, 5) }; // 2026년 5월 5일 (화)
            const result = formatTimestampShort(mockTimestamp);
            expect(result).toContain('5/5(화)');
        });

        it('toDate 함수가 없는 잘못된 값은 "-"를 반환한다', () => {
            expect(formatTimestampShort(null)).toBe('-');
            expect(formatTimestampShort(undefined)).toBe('-');
            expect(formatTimestampShort({})).toBe('-');
        });
    });

    describe('formatTimestampTime', () => {
        it('정상적인 TimestampLike 객체를 HH:MM(오전/오후) 형식 시간으로 변환한다', () => {
            const mockTimestamp = { toDate: () => new Date(2026, 4, 5, 14, 30) }; // 14:30
            const result = formatTimestampTime(mockTimestamp);
            // 한국어 로케일("오후 2:30")과 영어 로케일("PM 2:30" 또는 "PM 02:30") 모두 호환되도록 정규식 단언
            expect(result).toMatch(/(오후\s*0?2:30|PM\s*0?2:30)/i);
        });

        it('toDate 함수가 없는 잘못된 값은 빈 문자열을 반환한다', () => {
            expect(formatTimestampTime(null)).toBe('');
            expect(formatTimestampTime(undefined)).toBe('');
            expect(formatTimestampTime({})).toBe('');
        });

        it('hour12: false 옵션이면 24시간 표기로 변환한다', () => {
            const mockTimestamp = { toDate: () => new Date(2026, 4, 5, 14, 30) };
            expect(formatTimestampTime(mockTimestamp, { hour12: false })).toBe('14:30');
        });

        it('Date 객체를 직접 받아도 변환한다', () => {
            expect(formatTimestampTime(new Date(2026, 4, 5, 14, 30), { hour12: false })).toBe('14:30');
        });
    });

    describe('formatTimestampFull', () => {
        it('TimestampLike 객체를 YYYY.MM.DD HH:MM 형식으로 변환한다', () => {
            const mockTimestamp = { toDate: () => new Date(2026, 4, 5, 9, 5) }; // 2026년 5월 5일 09:05
            const result = formatTimestampFull(mockTimestamp);
            expect(result).toBe('2026.05.05 09:05');
        });

        it('Date 객체가 인입되었을 때 정상 작동한다', () => {
            const date = new Date(2026, 4, 5, 23, 59);
            const result = formatTimestampFull(date);
            expect(result).toBe('2026.05.05 23:59');
        });

        it('문자열 또는 숫자 타임스탬프 인입 시 정상 작동한다', () => {
            const dateStr = '2026-05-05T09:05:00';
            const result = formatTimestampFull(dateStr);
            expect(result).toBe('2026.05.05 09:05');
        });

        it('빈 값이 전달되면 null을 반환한다', () => {
            expect(formatTimestampFull(null)).toBeNull();
            expect(formatTimestampFull(undefined)).toBeNull();
        });

        it('유효하지 않은 날짜인 경우 null을 반환한다', () => {
            expect(formatTimestampFull('invalid-date')).toBeNull();
        });
    });

    describe('formatDateKr', () => {
        it('YYYY-MM-DD 형식 문자열을 M월 D일 (요일) 형식으로 변환한다', () => {
            const result = formatDateKr('2026-05-05'); // 2026년 5월 5일은 화요일
            expect(result).toContain('5월 5일');
            expect(result).toContain('화');
        });
    });
});
