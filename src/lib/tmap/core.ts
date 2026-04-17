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
        const res = await fetch(url, {
            method,
            headers,
            body: bodyObj ? JSON.stringify(bodyObj) : undefined,
        });

        if (!res.ok) {
            if (res.status === 429) {
                recordFail(true); // 즉시 쿨다운 활성화
                return null; // 빨간 에러 방지를 위해 throw 대신 조용히 null 반환
            }
            throw new Error(`T-Map API HTTP Error: ${res.status}`);
        }

        recordSuccess();
        return await res.json();
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
