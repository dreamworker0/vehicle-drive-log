/**
 * holiday — 공휴일 & 커스텀 휴일 통합 유틸
 * useReservationCalendar에서 사용하는 getHolidays 함수 제공
 */
import { fetchPublicHolidays } from './holidayApi';

/**
 * 현재 연도 공휴일을 CustomHoliday-호환 배열로 반환
 */
export const getHolidays = async (): Promise<{ date: string; name: string }[]> => {
    const year = new Date().getFullYear();
    const map = await fetchPublicHolidays(year);
    return Object.entries(map).map(([date, name]) => ({ date, name: name as string }));
};
