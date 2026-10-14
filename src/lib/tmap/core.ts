import { getAuthHeaders } from '../authFetch';

export const TMAP_API_KEY = import.meta.env.VITE_TMAP_API_KEY;

// 차종(vehicleType) → T-Map carType 매핑
export const VEHICLE_TYPE_TO_CAR_TYPE: Record<string, string> = {
    compact: '6',  // 경차 (톨비 50% 할인)
    sedan: '1',    // 승용차
    van: '2',      // 중형승합차
    bus: '3',      // 대형승합차
    truck: '1',    // 화물차 (1톤급은 승용차 요금)
};

// API 쿨다운 관리
let _cooldownUntil = 0;
const COOLDOWN_429_MS = 30 * 1000; // 429 시 30초 쿨다운
const COOLDOWN_FAIL_MS = 5 * 60 * 1000; // 연속 실패 시 5분 쿨다운
let _failCount = 0;
const MAX_FAIL = 3;

/** API 호출 전 쿨다운 체크 */
export const isTmapCoolingDown = () => Date.now() < _cooldownUntil;

/** 실패 기록 */
export const recordFail = (is429 = false) => {
    if (is429) {
        // 429는 즉시 쿨다운 (재시도 폭주 방지)
        _cooldownUntil = Math.max(_cooldownUntil, Date.now() + COOLDOWN_429_MS);
        console.warn(`TMap API 429 → ${COOLDOWN_429_MS / 1000}초 쿨다운`);
        return;
    }
    _failCount++;
    if (_failCount >= MAX_FAIL) {
        _cooldownUntil = Date.now() + COOLDOWN_FAIL_MS;
        console.warn(`TMap API ${MAX_FAIL}회 연속 실패 → ${COOLDOWN_FAIL_MS / 1000}초 쿨다운`);
    }
};

/** 성공 시 카운터 리셋 */
export const recordSuccess = () => { _failCount = 0; };

// LocalStorage 기반 캐싱 헬퍼
const GEO_CACHE_KEY = 'tmap_geo_cache_v1';
const ROUTE_CACHE_KEY = 'tmap_route_cache_v1';

const safeParseJSON = (str: string | null, fallback: unknown) => {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
};

const initialGeoData = safeParseJSON(typeof window !== 'undefined' ? localStorage.getItem(GEO_CACHE_KEY) : null, []);
const initialRouteData = safeParseJSON(typeof window !== 'undefined' ? localStorage.getItem(ROUTE_CACHE_KEY) : null, []);

// 지오코딩 캐시 (LocalStorage 영구 캐싱으로 API 중복 호출 최소화)
export const geoCache = new Map<string, { lat: number, lon: number, name: string } | null>(initialGeoData);
const originalGeoSet = geoCache.set.bind(geoCache);
geoCache.set = function(key, value) {
    const result = originalGeoSet(key, value);
    try { if (typeof window !== 'undefined') localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(Array.from(geoCache.entries()))); } catch { /* ignore */ }
    return result;
};

// 경로 결과 캐시 (동일 출발·도착 좌표 재조회 방지, 영구 캐싱)
export const routeCache = new Map<string, { distance: number; duration: number; tollFee: number; fuelCost: number } | null>(initialRouteData);
const originalRouteSet = routeCache.set.bind(routeCache);
routeCache.set = function(key, value) {
    const result = originalRouteSet(key, value);
    try { if (typeof window !== 'undefined') localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(Array.from(routeCache.entries()))); } catch { /* ignore */ }
    return result;
};

/** 요청 간 딜레이 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 글로벌 요청 큐 — 동시 1개 요청 + 요청 완료 후 최소 간격 보장
 * T-Map 무료 API의 rate limit(초당 ~1건)을 준수
 */
let _queue: Promise<void> = Promise.resolve();
const MIN_GAP_MS = 1200; // 무료 API 제약(초당 1건 수준) 준수를 위해 최소 1200ms 간격으로 상향
/** TMAP 요청 1건의 상한 — 직렬 큐라 멈춘 요청 하나가 뒤를 전부 막지 않게 한다 */
export const TMAP_FETCH_TIMEOUT_MS = 10_000;

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        _queue = _queue.then(async () => {
            if (isTmapCoolingDown()) {
                resolve(null as unknown as T);
                return;
            }
            try {
                const result = await fn();
                resolve(result);
            } catch (e) {
                reject(e);
            }
            // 다음 요청까지 최소 간격 보장
            await delay(MIN_GAP_MS);
        });
    });
}

/** 공통 T-Map API Fetch 헬퍼 — 글로벌 큐 적용, 429 즉시 쿨다운 */
export async function fetchTmap(prodUrl: string, devUrl: string, method = 'GET', bodyObj?: object) {
    // 쿨다운 중이면 즉시 null 반환 (조용히 스킵)
    if (isTmapCoolingDown()) return null;

    return enqueue(async () => {
        const isProd = import.meta.env.PROD;
        const url = isProd ? prodUrl : devUrl;

        const headers: Record<string, string> = {};
        if (bodyObj) headers['Content-Type'] = 'application/json';

        if (isProd) {
            Object.assign(headers, await getAuthHeaders());
        } else {
            headers['appKey'] = TMAP_API_KEY;
        }

        // 단일 시도 — 재시도는 큐 밖에서 하지 않음 (429 폭주 방지)
        // 상한을 둔다. 요청은 직렬 큐로 하나씩 처리되므로, 회선이 멈춘 요청 하나가 뒤의 지오코딩·경로
        // 요청을 전부 붙잡고 운행 시작 버튼이 계속 돌았다(2026-10-14 감사). 시간이 지나면 AbortError로
        // 끝나고, 호출부(딥링크·경로 추정)는 이미 실패 시 대체 경로를 갖고 있다.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TMAP_FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(url, {
                method,
                headers,
                body: bodyObj ? JSON.stringify(bodyObj) : undefined,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            if (res.status === 429) {
                recordFail(true); // 즉시 쿨다운 활성화
                return null; // 빨간 에러 방지를 위해 throw 대신 조용히 null 반환
            }
            // 400·404 = T맵이 **입력을 해석하지 못했다**(찾을 수 없는 주소 등) — 장애가 아니라 결과 없음이다.
            // 예전에는 예외로 올라가 geocode가 recordFail로 셌고, 찾을 수 없는 목적지를 3번 넣으면 5분 동안
            // T맵 기능 전체(경로 계산·길안내 좌표)가 쉬었다(2026-10-14 실측: 주소 변환 37건 중 400이 25건).
            // 실패 카운트에 넣지 않고 null을 돌려준다. 인증(401·403)·5xx·네트워크 오류는 지금처럼 예외다.
            if (res.status === 400 || res.status === 404) {
                return null;
            }
            throw new Error(`T-Map API HTTP Error: ${res.status}`);
        }

        recordSuccess();
        // 빈 본문(204/빈 200 응답)이면 JSON 파싱이 깨지므로 방어적으로 처리
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    });
}

/** TMap API 키 존재 여부 확인 */
export const isTmapAvailable = () => import.meta.env.PROD || !!TMAP_API_KEY;

/** 목적지 문자열을 쉼표로 분리하여 배열로 반환 */
export const MAX_DESTINATIONS = 5;
export const parseDestinations = (text: string) => {
    if (!text?.trim()) return [];
    return text.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_DESTINATIONS);
};

/**
 * 아직 칩(태그)으로 확정되지 않은 입력값을 목적지 문자열에 합친다.
 *
 * 목적지 입력창은 Enter·쉼표·검색결과 선택으로만 값이 확정된다. 직원이 글자만 쳐 놓고
 * 바로 제출을 누르는 경우가 잦으므로, 제출 시점에 남아 있는 입력을 목적지로 인정한다.
 * 이미 같은 목적지가 있거나 개수 상한이면 원문을 그대로 돌려준다.
 */
export const mergePendingDestination = (destination: string, pending: string) => {
    const trimmed = pending?.trim() ?? '';
    if (!trimmed) return destination;
    const list = parseDestinations(destination);
    if (list.includes(trimmed) || list.length >= MAX_DESTINATIONS) return destination;
    return [...list, trimmed].join(', ');
};
