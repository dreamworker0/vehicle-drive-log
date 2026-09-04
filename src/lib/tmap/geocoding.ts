import { fetchTmap, geoCache, isTmapCoolingDown, recordFail, recordSuccess } from './core';
import { TMAP_API_KEY } from './core';

/**
 * POI 검색으로 좌표 찾기
 */
export const searchPOI = async (keyword: string) => {
    if (!keyword?.trim() || keyword.trim().length < 2 || (!import.meta.env.PROD && !TMAP_API_KEY)) return null;

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

export interface PoiResult {
    lat: number;
    lon: number;
    name: string;
    address: string;
}

/**
 * POI 검색으로 후보 목록 반환 (드롭다운용)
 */
export const searchPOIList = async (keyword: string, count = 5): Promise<PoiResult[]> => {
    if (!keyword?.trim() || keyword.trim().length < 2 || (!import.meta.env.PROD && !TMAP_API_KEY)) return [];

    try {
        const data = await fetchTmap(
            `/api/tmap?action=poi&keyword=${encodeURIComponent(keyword)}&count=${count}`,
            `/api/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=${count}`
        );

        const pois = data?.searchPoiInfo?.pois?.poi;
        if (!Array.isArray(pois)) return [];

        return pois
            .filter((poi: Record<string, string>) => poi.noorLat && poi.noorLon)
            .map((poi: Record<string, string>) => {
                const parts = [poi.upperAddrName, poi.middleAddrName, poi.roadName || poi.lowerAddrName]
                    .filter(Boolean);
                return {
                    lat: parseFloat(poi.noorLat),
                    lon: parseFloat(poi.noorLon),
                    name: poi.name || keyword,
                    address: parts.join(' '),
                };
            });
    } catch (err) {
        console.error('POI 리스트 검색 실패:', err);
        return [];
    }
};


/**
 * 드롭다운에서 고른 장소의 좌표를 `geocode` 캐시에 미리 심는다.
 *
 * POI 검색은 이미 `lat`/`lon`을 함께 돌려주는데, 목적지 입력창은 그 좌표를 버리고
 * 문자열(`"이름 (주소)"`)만 저장해 왔다. 그러면 경로를 계산할 때 `geocode`가 **방금 고른
 * 바로 그 장소를 다시 검색한다** — 목적지 하나당 POI 호출 1건이 확정적으로 낭비된다
 * (2026-09-05 기준 하루 경로 300건 ≒ POI 300건, 전체 POI 호출의 약 1/3).
 *
 * @param address `geocode`가 나중에 넘겨받을 문자열과 **정확히 같아야** 한다. 다르면
 *   캐시가 빗나가고 예전처럼 API를 부를 뿐이라, 틀려도 조용히 손해만 볼 뿐 깨지지는 않는다.
 */
export function primeGeocodeCache(
    address: string,
    coord: { lat: number; lon: number; name: string },
): void {
    const key = address?.trim();
    if (!key) return;
    // 좌표가 없는 결과로 캐시를 오염시키지 않는다 — null을 심으면 그 목적지는 이후
    // 계속 "찾을 수 없음"으로 굳어 경로 계산이 조용히 실패한다.
    if (!Number.isFinite(coord?.lat) || !Number.isFinite(coord?.lon)) return;
    geoCache.set(key, { lat: coord.lat, lon: coord.lon, name: coord.name || key });
}

/**
 * 주소 → 좌표 변환 (지오코딩)
 * 캐싱 적용
 */
export const geocode = async (address: string) => {
    if (!address?.trim() || address.trim().length < 2) return null;
    if (geoCache.has(address)) return geoCache.get(address) || null;
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    // 괄호 전처리: "서울역 (서울 용산구 청파동3가 10-3)" -> 괄호 내 실제 주소("서울 용산구 청파동3가 10-3") 추출
    const match = address.match(/\(([^)]+)\)/);
    const cleanAddress = match ? match[1].trim() : address.trim();
    const cleanName = match ? address.replace(/\([^)]+\)/, '').trim() : address.trim();

    // 1차 시도: 괄호 안의 정제된 주소로 POI 검색 시도
    let result = await searchPOI(cleanAddress);
    
    if (!result && cleanAddress !== address) {
        // 주소로 실패 시, 2차 시도로 괄호 앞의 장소명(cleanName)으로 검색 시도
        result = await searchPOI(cleanName);
    }

    if (!result) {
        try {
            // POI 검색이 모두 실패할 경우 3차 시도로 정제 주소를 티맵 지오코딩 API에 전달
            const data = await fetchTmap(
                `/api/tmap?action=geocode&address=${encodeURIComponent(cleanAddress)}`,
                `/api/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(cleanAddress)}`
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
