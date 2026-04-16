/**
 * recurringUtils — 반복(정기) 예약 날짜 생성 유틸리티
 *
 * - 요일 패턴 기반 날짜 목록 생성
 * - 공휴일 자동 제외
 * - 수동 제외 날짜 필터링
 */
import { eachDayOfInterval, getDay, format } from 'date-fns';

export interface RecurringOptions {
    startDate: string;        // 'YYYY-MM-DD'
    endDate: string;          // 'YYYY-MM-DD'
    selectedDays: number[];   // 요일 배열 [0=일, 1=월, ..., 6=토]
    holidays: { date: string; name: string }[];
    excludeHolidays: boolean;
    excludedDates?: string[]; // 수동 제외 날짜
}

/**
 * 반복 예약 대상 날짜 목록을 생성합니다.
 */
export function generateRecurringDates(options: RecurringOptions): string[] {
    const { startDate, endDate, selectedDays, holidays, excludeHolidays, excludedDates = [] } = options;

    if (!startDate || !endDate || selectedDays.length === 0) return [];
    if (endDate < startDate) return [];

    const start = new Date(startDate + 'T00:00');
    const end = new Date(endDate + 'T00:00');

    const allDays = eachDayOfInterval({ start, end });
    const holidaySet = new Set(holidays.map(h => h.date));
    const excludedSet = new Set(excludedDates);

    return allDays
        .filter(d => {
            const dayOfWeek = getDay(d); // 0=일, 1=월, ..., 6=토
            const dateStr = format(d, 'yyyy-MM-dd');

            // 선택된 요일이 아니면 제외
            if (!selectedDays.includes(dayOfWeek)) return false;

            // 공휴일 제외
            if (excludeHolidays && holidaySet.has(dateStr)) return false;

            // 수동 제외 날짜
            if (excludedSet.has(dateStr)) return false;

            return true;
        })
        .map(d => format(d, 'yyyy-MM-dd'));
}

/** 요일 이름 매핑 */
export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 반복 그룹 ID 생성 */
export function generateRecurringGroupId(): string {
    return `rcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
