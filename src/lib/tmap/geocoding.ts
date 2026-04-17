import { fetchTmap, geoCache, isTmapCoolingDown, recordFail, recordSuccess } from './core';
import { TMAP_API_KEY } from './core';

/**
 * POI 검색으로 좌표 찾기
 */
export const searchPOI = async (keyword: string) => {
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
