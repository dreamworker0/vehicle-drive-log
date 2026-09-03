/**
 * 공공데이터 포털 - 한국천문연구원 특일 정보 API
 * https://www.data.go.kr/data/15012690/openapi.do
 *
 * getRestDeInfo: 공휴일(국경일 포함) 정보 조회
 */

import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getAuthHeaders } from './authFetch';

const API_KEY = import.meta.env.VITE_HOLIDAY_API_KEY;

/**
 * 외부 공공데이터 API 폴백의 응답 대기 상한(ms).
 *
 * 이 fetch에는 원래 타임아웃이 없어 외부 서비스가 응답하지 않으면 무기한 대기했다.
 * 호출부가 이 Promise를 await하고 있으면 화면이 그대로 인질이 된다(예약 화면 무한 스피너).
 * 공휴일은 없어도 화면이 동작하는 부가 정보이므로, 기다리느니 비우고 진행하는 편이 낫다.
 */
const FALLBACK_TIMEOUT_MS = 5000;

/**
 * 폴백을 타게 된 사유 코드의 상한 길이. 서버가 로그에 그대로 적으므로 짧게 묶는다.
 */
const FALLBACK_REASON_MAX = 64;

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

    /**
     * 폴백을 타게 된 사유. 프록시(holidayProxy)에 실어 보내 서버 로그에 남긴다.
     *
     * **왜 남기나.** 월배치(syncHolidays)가 올해·내년을 Firestore에 채우므로 이 폴백은 원래
     * 거의 돌지 않아야 하는데, 실제로는 하루 한 번쯤 프록시가 호출됐다(2026-08-25~09-03 7건,
     * 전부 올해 조회). 아래 catch가 사유를 console.warn으로만 흘려서 **왜 도는지 알 수 없었다**
     * (Phase 200 남는 것 ②). 사유 코드를 서버 로그에 남기면 다음 발생이 스스로 답한다.
     *
     * 사유를 읽는 법: `firestore-permission-denied`인데 **프록시 호출은 성공**했다면
     * 그 사용자는 로그인 상태였다는 뜻이다(프록시는 Auth 토큰을 요구한다). Rules는 로그인만
     * 요구하므로(`system/holidays`: isSignedIn) 남는 원인은 **App Check**다 — Firestore는
     * 강제(ENFORCED) 대상이고, reCAPTCHA 토큰이 막히면 최대 24시간 거부된다(firebase.ts 주석).
     * 프록시는 App Check를 검사하지 않아 그때도 성공한다. `unavailable`이면 네트워크·오프라인,
     * `failed-precondition`·terminated류면 로그아웃 전환 중 종료된 인스턴스다.
     */
    let fallbackReason = 'unknown';

    try {
        // 2. Firestore에서 먼저 조회 시도
        const docRef = doc(db, 'system', 'holidays');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data() as Record<string, unknown>;
            if (data[yearStr]) {
                map = data[yearStr] as Record<string, string>;
                cache[year] = map;
                console.debug(`Loaded holidays for ${year} from Firestore`);
                return map;
            }
            // 문서는 읽혔는데 그 해가 없다 — 월배치가 채우는 범위(올해·내년) 밖이면 정상이다
            fallbackReason = 'year-missing';
        } else {
            fallbackReason = 'doc-missing';
        }
    } catch (dbError) {
        const code = (dbError as { code?: string })?.code;
        fallbackReason = `firestore-${code || 'error'}`;
        console.warn('Firestore에서 휴일 정보를 가져오지 못했습니다. API 폴백을 시도합니다.', dbError);
    }

    // 3. Firestore에 데이터가 없거나 에러 발생 시, 공공데이터 API 폴백 호출
    console.debug(`Fetching holidays for ${year} from public API as fallback`);
    try {
        let url;
        if (import.meta.env.DEV) {
            // 개발 환경: Vite 프록시 사용
            url = `/api/holiday/getRestDeInfo?serviceKey=${API_KEY}&solYear=${year}&numOfRows=50&_type=json`;
        } else {
            // 프로덕션 환경: Cloud Function 프록시 사용
            url = `/api/holiday?solYear=${year}&numOfRows=50`
                + `&fallbackReason=${encodeURIComponent(fallbackReason.slice(0, FALLBACK_REASON_MAX))}`;
        }
        // 응답이 없는 외부 API에 화면이 묶이지 않도록 상한을 둔다.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);

        let res: Response;
        try {
            res = await fetch(url, {
                headers: import.meta.env.PROD ? await getAuthHeaders() : {},
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

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
        if ((err as Error)?.name === 'AbortError') {
            console.warn(`공휴일 API ${FALLBACK_TIMEOUT_MS}ms 초과 — 공휴일 없이 진행합니다.`);
        } else {
            console.error('공휴일 API 호출 실패:', err);
        }
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
