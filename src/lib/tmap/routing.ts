import { fetchTmap, isTmapCoolingDown, routeCache } from './core';
import { TMAP_API_KEY } from './core';
import { geocode } from './geocoding';
import { parseDestinations } from './core';

/** 자동차 경로 탐색 (캐싱 적용) */
export const getRoute = async (startLon: number, startLat: number, endLon: number, endLat: number, { carType = '0', searchOption = '0' } = {}) => {
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

/** 주소로 경로 탐색 (원스톱) */
export const getRouteByAddress = async (startAddress: string, endAddress: string, { carType = '0', searchOption = '0' } = {}) => {
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

/**
 * 기존(추천) 경로 조회 — 일반 경로만 반환
 * 무료도로 비교는 getFreeRoadRoute()로 별도 on-demand 호출
 */
export const getMultiRouteWithFreeRoad = async (origin: string, destinationText: string, { carType = '0' } = {}) => {
    const normal = await getMultiRoute(origin, destinationText, { carType, searchOption: '0' });
    if (!normal) return null;
    // hasToll: 통행료가 있는 경로임을 UI에 알려 펼치기 버튼 표시 여부 결정
    return { ...normal, hasToll: (normal.tollFee ?? 0) > 0, freeRoadRoute: undefined };
};

/**
 * 무료도로 경로 on-demand 조회
 * 사용자가 펼치기 버튼을 클릭했을 때만 호출
 */
export const getFreeRoadRoute = async (
    origin: string,
    destinationText: string,
    { carType = '0' } = {},
): Promise<{ distance: number; duration: number; tollFee: number } | null> => {
    if (isTmapCoolingDown()) return null;
    const freeRoad = await getMultiRoute(origin, destinationText, { carType, searchOption: '1' });
    if (!freeRoad) return null;
    return {
        distance: freeRoad.distance,
        duration: freeRoad.duration,
        tollFee: freeRoad.tollFee || 0,
    };
};
