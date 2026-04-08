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

// API 실패 쿨다운 (3회 연속 실패 시 5분간 비활성화)
let _failCount = 0;
let _cooldownUntil = 0;
const COOLDOWN_MS = 5 * 60 * 1000; // 5분
const MAX_FAIL = 3;

/** API 호출 전 쿨다운 체크 */
export const isTmapCoolingDown = () => Date.now() < _cooldownUntil;

/** 실패 기록 */
const recordFail = () => {
    _failCount++;
    if (_failCount >= MAX_FAIL) {
        _cooldownUntil = Date.now() + COOLDOWN_MS;
        console.warn(`TMap API ${MAX_FAIL}회 연속 실패 → ${COOLDOWN_MS / 1000}초 쿨다운`);
    }
};

/** 성공 시 카운터 리셋 */
const recordSuccess = () => { _failCount = 0; };

// 지오코딩 캐시 (메모리 캐싱으로 API 중복 호출 최소화)
const geoCache = new Map<string, { lat: number, lon: number, name: string } | null>();

/** 공통 T-Map API Fetch 헬퍼 - 중복 제거 및 지수 백오프 기반 재시도 적용 */
async function fetchTmap(prodUrl: string, devUrl: string, method = 'GET', bodyObj?: object) {
    const isProd = import.meta.env.PROD;
    const url = isProd ? prodUrl : devUrl;
    
    const headers: Record<string, string> = {};
    if (bodyObj) headers['Content-Type'] = 'application/json';
    
    if (isProd) {
        Object.assign(headers, await getAuthHeaders());
    } else {
        headers['appKey'] = TMAP_API_KEY;
    }

    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            const res = await fetch(url, {
                method,
                headers,
                body: bodyObj ? JSON.stringify(bodyObj) : undefined,
            });
            
            if (!res.ok) {
                // 429(Too Many Requests) 혹여는 5xx 계열 서버 에러일 경우에만 재시도 타겟으로 삼음
                if (res.status === 429 || res.status >= 500) {
                    throw new Error(`T-Map API HTTP Error: ${res.status}`);
                }
                // 400~404 등 클라이언트 요청 오류는 재시도 없이 바로 에러 던짐
                throw new Error(`T-Map API HTTP Error (No Retry): ${res.status}`);
            }
            return await res.json();
        } catch (error: any) {
            attempt++;
            const isNoRetry = error instanceof Error && error.message.includes('No Retry');
            if (attempt >= MAX_RETRIES || isNoRetry) {
                throw error;
            }
            // Exponential backoff: 500ms -> 1000ms -> 2000ms
            const backoffTime = 500 * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
    }
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
export const geocode = async (address: string) => {
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

/** 자동차 경로 탐색 */
export const getRoute = async (startLon: number, startLat: number, endLon: number, endLat: number, { carType = '0', searchOption = '0' } = {}) => {
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

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
        if (!props) return null;

        return {
            distance: Math.floor(props.totalDistance / 1000), 
            duration: Math.round(props.totalTime / 60), 
            tollFee: props.totalFare || 0, 
            fuelCost: props.taxiFare || 0, 
        };
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
export const getRouteByAddress = async (startAddress: string, endAddress: string, { carType = '0', searchOption = '0' } = {}) => {
    if (!startAddress?.trim() || !endAddress?.trim()) return null;

    const [startCoord, endCoord] = await Promise.all([
        geocode(startAddress),
        geocode(endAddress),
    ]);

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
    const coords = await Promise.all(allAddresses.map(addr => geocode(addr)));
    if (coords.some(c => !c)) return null;

    // 병렬로 모든 구간 경로 탐색 (기존 순차 방식에서 개선)
    const routePromises = coords.map((from, i) => {
        const to = coords[(i + 1) % coords.length]!; // 순환
        return getRoute(from!.lon, from!.lat, to.lon, to.lat, { carType, searchOption });
    });

    const routeResults = await Promise.all(routePromises);
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
export const getTmapDeeplink = async (destination: string) => {
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
export const getNaverMapDeeplink = async (destination: string) => {
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
export const getKakaoMapDeeplink = async (destination: string) => {
    if (!destination) return 'kakaomap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'kakaomap://open';

    try {
        const coords = await Promise.all(dests.map(d => geocode(d)));
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

/** 기존(추천) 경로와 무료도로 경로를 병렬 조회 */
export const getMultiRouteWithFreeRoad = async (origin: string, destinationText: string, { carType = '0' } = {}) => {
    const [normal, freeRoad] = await Promise.all([
        getMultiRoute(origin, destinationText, { carType, searchOption: '0' }),
        getMultiRoute(origin, destinationText, { carType, searchOption: '1' }),
    ]);

    if (!normal) return null;

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
};
