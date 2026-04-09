import { getAuthHeaders } from './authFetch';

const TMAP_API_KEY = import.meta.env.VITE_TMAP_API_KEY;

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
const recordFail = (is429 = false) => {
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
const recordSuccess = () => { _failCount = 0; };

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
const geoCache = new Map<string, { lat: number, lon: number, name: string } | null>(initialGeoData);
const originalGeoSet = geoCache.set.bind(geoCache);
geoCache.set = function(key, value) {
    const result = originalGeoSet(key, value);
    try { if (typeof window !== 'undefined') localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(Array.from(geoCache.entries()))); } catch { /* ignore */ }
    return result;
};

// 경로 결과 캐시 (동일 출발·도착 좌표 재조회 방지, 영구 캐싱)
const routeCache = new Map<string, { distance: number; duration: number; tollFee: number; fuelCost: number } | null>(initialRouteData);
const originalRouteSet = routeCache.set.bind(routeCache);
routeCache.set = function(key, value) {
    const result = originalRouteSet(key, value);
    try { if (typeof window !== 'undefined') localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(Array.from(routeCache.entries()))); } catch { /* ignore */ }
    return result;
};

/** 요청 간 딜레이 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 글로벌 요청 큐 — 동시 1개 요청 + 요청 완료 후 최소 간격 보장
 * T-Map 무료 API의 rate limit(초당 ~1건)을 준수
 */
let _queue: Promise<void> = Promise.resolve();
const MIN_GAP_MS = 1200; // 무료 API 제약(초당 1건 수준) 준수를 위해 최소 1200ms 간격으로 상향

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
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
async function fetchTmap(prodUrl: string, devUrl: string, method = 'GET', bodyObj?: object) {
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

/**
 * POI 검색으로 좌표 찾기
 */
const searchPOI = async (keyword: string) => {
    if (!keyword?.trim() || (!import.meta.env.PROD && !TMAP_API_KEY)) return null;

    try {
        const data = await fetchTmap(
            `/api/tmap?action=poi&keyword=${encodeURIComponent(keyword)}`,
            `/api/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`
        );

        const poi = data?.searchPoiInfo?.pois?.poi?.[0];
        if (!poi) return null;
        return {
            lat: parseFloat(poi.noorLat),
            lon: parseFloat(poi.noorLon),
            name: poi.name || keyword,
        };
    } catch (err) {
        console.error('POI 검색 실패:', err);
        return null;
    }
};

/**
 * 주소 → 좌표 변환 (지오코딩)
 * 캐싱 적용
 */
const geocode = async (address: string) => {
    if (!address?.trim()) return null;
    if (geoCache.has(address)) return geoCache.get(address) || null;
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    let result = await searchPOI(address);
    
    if (!result) {
        try {
            const data = await fetchTmap(
                `/api/tmap?action=geocode&address=${encodeURIComponent(address)}`,
                `/api/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address)}`
            );

            const item = data?.coordinateInfo?.coordinate?.[0];
            if (item) {
                const lat = parseFloat(item.newLat || item.lat);
                const lon = parseFloat(item.newLon || item.lon);
                if (lat && lon) {
                    result = { lat, lon, name: address };
                }
            }
        } catch (err) {
            console.error('지오코딩 실패:', err);
            recordFail();
            geoCache.set(address, null);
            return null;
        }
    }

    if (result) recordSuccess();
    geoCache.set(address, result);
    return result;
};

/** 자동차 경로 탐색 (캐싱 적용) */
const getRoute = async (startLon: number, startLat: number, endLon: number, endLat: number, { carType = '0', searchOption = '0' } = {}) => {
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    // 캐시 키: 좌표+옵션 조합 (소수점 5자리로 정규화)
    const cacheKey = `${startLon.toFixed(5)},${startLat.toFixed(5)}-${endLon.toFixed(5)},${endLat.toFixed(5)}-${carType}-${searchOption}`;
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey) || null;

    const routeBody = {
        startX: startLon.toString(),
        startY: startLat.toString(),
        endX: endLon.toString(),
        endY: endLat.toString(),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        searchOption,
        carType,
    };

    try {
        const data = await fetchTmap(
            '/api/tmap?action=route',
            '/api/tmap/routes?version=1&format=json',
            'POST',
            routeBody
        );

        const props = data?.features?.[0]?.properties;
        if (!props) { routeCache.set(cacheKey, null); return null; }

        const result = {
            distance: Math.floor(props.totalDistance / 1000), 
            duration: Math.round(props.totalTime / 60), 
            tollFee: props.totalFare || 0, 
            fuelCost: props.taxiFare || 0, 
        };
        routeCache.set(cacheKey, result);
        return result;
    } catch (err) {
        console.error('경로 탐색 실패:', err);
        return null;
    }
};

/** 목적지 문자열을 쉼표로 분리하여 배열로 반환 */
export const MAX_DESTINATIONS = 5;
export const parseDestinations = (text: string) => {
    if (!text?.trim()) return [];
    return text.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_DESTINATIONS);
};

/** 주소로 경로 탐색 (원스톱) */
const getRouteByAddress = async (startAddress: string, endAddress: string, { carType = '0', searchOption = '0' } = {}) => {
    if (!startAddress?.trim() || !endAddress?.trim()) return null;

    // 순차 호출 (큐 내에서도 rate limit 준수)
    const startCoord = await geocode(startAddress);
    const endCoord = await geocode(endAddress);

    if (!startCoord || !endCoord) return null;

    const route = await getRoute(startCoord.lon, startCoord.lat, endCoord.lon, endCoord.lat, { carType, searchOption });
    if (!route) return null;

    return {
        ...route,
        startCoord,
        endCoord,
    };
};

/**
 * 다중 목적지 경로 탐색
 * 병렬 처리를 통해 성능 최적화 적용
 */
export const getMultiRoute = async (origin: string, destinationText: string, { carType = '0', searchOption = '0' } = {}) => {
    const dests = parseDestinations(destinationText);
    if (dests.length === 0 || !origin?.trim()) return null;

    if (dests.length === 1) {
        const result = await getRouteByAddress(origin, dests[0], { carType, searchOption });
        if (!result) return null;
        return { ...result, isMulti: false };
    }

    const allAddresses = [origin, ...dests];
    // 순차 지오코딩 (글로벌 큐가 간격 보장)
    const coords = [];
    for (const addr of allAddresses) {
        const coord = await geocode(addr);
        coords.push(coord);
    }
    if (coords.some(c => !c)) return null;

    // 순차 라우팅 (글로벌 큐가 700ms 간격 보장)
    const routeResults = [];
    for (let i = 0; i < coords.length; i++) {
        const from = coords[i]!;
        const to = coords[(i + 1) % coords.length]!;
        const result = await getRoute(from.lon, from.lat, to.lon, to.lat, { carType, searchOption });
        routeResults.push(result);
    }
    if (routeResults.some(r => !r)) return null;

    const segments = routeResults.map((seg, i) => ({
        from: allAddresses[i],
        to: allAddresses[(i + 1) % allAddresses.length],
        distance: seg!.distance,
        duration: seg!.duration,
        tollFee: seg!.tollFee || 0,
    }));

    // 편도 합산
    const oneWaySegments = segments.slice(0, -1);
    const totalDistance = oneWaySegments.reduce((sum, s) => sum + s.distance, 0);
    const totalTollFee = oneWaySegments.reduce((sum, s) => sum + s.tollFee, 0);
    const oneWayDuration = oneWaySegments.reduce((sum, s) => sum + s.duration, 0);

    return {
        distance: totalDistance,
        duration: oneWayDuration,
        tollFee: totalTollFee,
        isMulti: true,
        segments,
    };
};

/** TMap 경로 안내 딥링크 생성 */
const getTmapDeeplink = async (destination: string) => {
    if (!destination) return 'tmap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'tmap://open';

    const goalName = dests[0];
    try {
        const goalCoord = await geocode(goalName);
        let url = 'tmap://route?';
        if (goalCoord) {
            url += `goalname=${encodeURIComponent(goalName)}&goalx=${goalCoord.lon}&goaly=${goalCoord.lat}`;
        } else {
            url += `goalname=${encodeURIComponent(goalName)}`;
        }
        return url;
    } catch (e) {
        console.warn('TMap 딥링크 생성 실패:', e);
    }
    return `tmap://route?goalname=${encodeURIComponent(goalName)}`;
};

/** TMap API 키 존재 여부 확인 */
export const isTmapAvailable = () => import.meta.env.PROD || !!TMAP_API_KEY;

/** 네이버 지도 경로 안내 딥링크 생성 */
const getNaverMapDeeplink = async (destination: string) => {
    if (!destination) return 'nmap://actionPath?appname=vehicle-log';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'nmap://actionPath?appname=vehicle-log';

    try {
        const coords = await Promise.all(dests.map(d => geocode(d)));
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'nmap://actionPath?appname=vehicle-log';

        let url = `nmap://navigation?dlat=${goalCoord.lat}&dlng=${goalCoord.lon}&dname=${encodeURIComponent(dests[goalIdx])}&appname=vehicle-log`;

        for (let i = 0; i < Math.min(goalIdx, 5); i++) {
            if (coords[i]) {
                url += `&v${i + 1}lat=${coords[i]!.lat}&v${i + 1}lng=${coords[i]!.lon}&v${i + 1}name=${encodeURIComponent(dests[i])}`;
            }
        }
        return url;
    } catch (e) {
        console.warn('네이버 지도 딥링크 생성 실패:', e);
    }
    return 'nmap://actionPath?appname=vehicle-log';
};

/** 카카오맵 경로 안내 딥링크 생성 */
const getKakaoMapDeeplink = async (destination: string) => {
    if (!destination) return 'kakaomap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'kakaomap://open';

    try {
        const coords = [];
        for (const d of dests) {
            coords.push(await geocode(d));
        }
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'kakaomap://open';

        let url = `kakaomap://route?ep=${goalCoord.lat},${goalCoord.lon}&by=CAR`;

        for (let i = 0; i < goalIdx; i++) {
            if (coords[i]) {
                url += `&wp${i + 1}=${coords[i]!.lat},${coords[i]!.lon}`;
            }
        }
        return url;
    } catch (e) {
        console.warn('카카오맵 딥링크 생성 실패:', e);
    }
    return 'kakaomap://open';
};

/** 통합 내비게이션 딥링크 생성 */
export const getNavigationDeeplink = async (app: string, destination: string) => {
    switch (app) {
        case 'naver': return getNaverMapDeeplink(destination);
        case 'kakao': return getKakaoMapDeeplink(destination);
        case 'tmap':
        default: return getTmapDeeplink(destination);
    }
};

/** 목적지 문자열로 경로 정보 조회 */
export const getRouteInfo = async (destination: string) => {
    try {
        const coord = await geocode(destination);
        if (!coord) return null;
        const result = await getRoute(coord.lon, coord.lat, coord.lon, coord.lat);
        return result ? { distance: result.distance, duration: result.duration } : null;
    } catch {
        return null;
    }
};

/** 기존(추천) 경로와 무료도로 경로를 순차 조회 */
export const getMultiRouteWithFreeRoad = async (origin: string, destinationText: string, { carType = '0' } = {}) => {
    // 일반 경로 우선 조회
    const normal = await getMultiRoute(origin, destinationText, { carType, searchOption: '0' });

    // 일반 경로 실패 또는 쿨다운 시 무료도로 조회 스킵
    if (!normal || isTmapCoolingDown()) {
        return normal ? { ...normal, freeRoadRoute: undefined } : normal;
    }

    // 통행료가 있을 때만 무료도로 대체 경로를 조회 (비용 절약)
    if (normal.tollFee && normal.tollFee > 0) {
        const freeRoad = await getMultiRoute(origin, destinationText, { carType, searchOption: '1' });
        const isDifferent = freeRoad && (
            Math.floor(freeRoad.distance) !== Math.floor(normal.distance) ||
            (freeRoad.tollFee || 0) !== (normal.tollFee || 0)
        );

        return {
            ...normal,
            freeRoadRoute: isDifferent ? {
                distance: freeRoad.distance,
                duration: freeRoad.duration,
                tollFee: freeRoad.tollFee || 0,
            } : undefined,
        };
    }

    return { ...normal, freeRoadRoute: undefined };
};
