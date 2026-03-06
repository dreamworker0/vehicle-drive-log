/**
 * 공공데이터 포털 - 한국천문연구원 특일 정보 API
 * https://www.data.go.kr/data/15012690/openapi.do
 *
 * getRestDeInfo: 공휴일(국경일 포함) 정보 조회
 */

import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

const API_KEY = import.meta.env.VITE_HOLIDAY_API_KEY;

// 연도별 캐시
const cache: Record<number, Record<string, string>> = {};

/**
 * 특정 연도의 공휴일 목록을 가져옵니다.
 * @param {number} year - 조회할 연도 (예: 2026)
 * @returns {Promise<Object>} { 'YYYY-MM-DD': '공휴일명', ... }
 */
export const fetchPublicHolidays = async (year: number) => {
    // 1. 메모리 캐시 확인
    if (cache[year]) return cache[year];

    const yearStr = String(year);
    let map: Record<string, string> = {};

    try {
        // 2. Firestore에서 먼저 조회 시도
        const docRef = doc(db, 'system', 'holidays');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data() as Record<string, unknown>;
            if (data[yearStr]) {
                map = data[yearStr] as Record<string, string>;
                cache[year] = map;
                console.log(`Loaded holidays for ${year} from Firestore`);
                return map;
            }
        }
    } catch (dbError) {
        console.warn('Firestore에서 휴일 정보를 가져오지 못했습니다. API 폴백을 시도합니다.', dbError);
    }

    // 3. Firestore에 데이터가 없거나 에러 발생 시, 공공데이터 API 폴백 호출
    console.log(`Fetching holidays for ${year} from public API as fallback`);
    try {
        let url;
        if (import.meta.env.DEV) {
            // 개발 환경: Vite 프록시 사용
            url = `/api/holiday/getRestDeInfo?serviceKey=${API_KEY}&solYear=${year}&numOfRows=50&_type=json`;
        } else {
            // 프로덕션 환경: Cloud Function 프록시 사용
            url = `/api/holiday?solYear=${year}&numOfRows=50`;
        }
        const res = await fetch(url);

        if (!res.ok) {
            console.error('공휴일 API 응답 오류:', res.status);
            return map;
        }

        const data = await res.json();
        const items = data?.response?.body?.items?.item;

        if (!items) return map;

        // items가 단일 객체일 수도, 배열일 수도 있음
        const list = Array.isArray(items) ? items : [items];

        list.forEach((item: { isHoliday: string; locdate: number; dateName: string }) => {
            if (item.isHoliday === 'Y') {
                const locdate = String(item.locdate);
                const dateStr = `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`;
                (map as Record<string, string>)[dateStr] = item.dateName;
            }
        });

        // 메모리 캐시 저장
        cache[year] = map;
    } catch (err) {
        console.error('공휴일 API 호출 실패:', err);
    }

    return map;
};

/**
 * 공휴일 데이터를 월별로 그룹핑합니다.
 * @param {Object} holidayMap - { 'YYYY-MM-DD': '공휴일명' }
 * @returns {Object} { month: [{ date, name }] }
 */
export const groupHolidaysByMonth = (holidayMap: Record<string, string>) => {
    const grouped: Record<number, { date: string; name: string }[]> = {};
    Object.entries(holidayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, name]) => {
            const month = parseInt(date.slice(5, 7));
            if (!grouped[month]) grouped[month] = [];
            grouped[month].push({ date, name });
        });
    return grouped;
};
