const TMAP_API_KEY = import.meta.env.VITE_TMAP_API_KEY;

// 차종(vehicleType) → T-Map carType 매핑
// 0: 미선택(기본), 1: 승용차, 2: 중형승합차, 3: 대형승합차,
// 4: 대형화물차, 5: 특수화물차, 6: 경차, 7: 이륜차
export const VEHICLE_TYPE_TO_CAR_TYPE = {
    compact: '6',  // 경차 (톨비 50% 할인)
    sedan: '1',    // 승용차
    van: '2',      // 중형승합차
    bus: '3',      // 대형승합차
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
/**
 * 주소 → 좌표 변환 (지오코딩)
 * POI 검색을 우선 시도 (장소명에 더 정확), 실패 시 주소 API로 폴백
 * @param {string} address - 검색할 주소/장소명
 * @returns {Promise<{lat: number, lon: number, name: string} | null>}
 */
export const geocode = async (address) => {
    if (!address?.trim()) return null;
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    // 1. POI 검색 우선 (장소명에 더 정확)
    const poiResult = await searchPOI(address);
    if (poiResult) {
        recordSuccess();
        return poiResult;
    }

    // 2. POI에서 못 찾으면 주소 API로 폴백
    try {
        let data;
        if (import.meta.env.PROD) {
            const res = await fetch(`/api/tmap?action=geocode&address=${encodeURIComponent(address)}`);
            data = await res.json();
        } else {
            const res = await fetch(`/api/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address)}`, {
                headers: { appKey: TMAP_API_KEY },
            });
            data = await res.json();
        }

        const item = data?.coordinateInfo?.coordinate?.[0];
        if (!item) return null;
        const lat = parseFloat(item.newLat || item.lat);
        const lon = parseFloat(item.newLon || item.lon);
        if (!lat || !lon) return null;
        recordSuccess();
        return { lat, lon, name: address };
    } catch (err) {
        console.error('지오코딩 실패:', err);
        recordFail();
        return null;
    }
};

/**
 * POI 검색으로 좌표 찾기
 */
const searchPOI = async (keyword) => {
    if (!keyword?.trim()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    try {
        let data;
        if (import.meta.env.PROD) {
            const res = await fetch(`/api/tmap?action=poi&keyword=${encodeURIComponent(keyword)}`);
            data = await res.json();
        } else {
            const res = await fetch(`/api/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`, {
                headers: { appKey: TMAP_API_KEY },
            });
            data = await res.json();
        }

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
 * 자동차 경로 탐색
 * @param {number} startLon - 출발지 경도
 * @param {number} startLat - 출발지 위도
 * @param {number} endLon - 도착지 경도
 * @param {number} endLat - 도착지 위도
 * @returns {Promise<{distance: number, duration: number, tollFee: number, fuelCost: number} | null>}
 */
export const getRoute = async (startLon, startLat, endLon, endLat, { carType = '0' } = {}) => {
    if (isTmapCoolingDown()) return null;
    if (!import.meta.env.PROD && !TMAP_API_KEY) return null;

    const routeBody = {
        startX: startLon.toString(),
        startY: startLat.toString(),
        endX: endLon.toString(),
        endY: endLat.toString(),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        searchOption: '0',
        carType,
    };

    try {
        let data;
        if (import.meta.env.PROD) {
            const res = await fetch('/api/tmap?action=route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(routeBody),
            });
            data = await res.json();
        } else {
            const res = await fetch('/api/tmap/routes?version=1&format=json', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    appKey: TMAP_API_KEY,
                },
                body: JSON.stringify(routeBody),
            });
            data = await res.json();
        }

        const props = data?.features?.[0]?.properties;
        if (!props) return null;

        return {
            distance: Math.floor(props.totalDistance / 1000), // km (정수)
            duration: Math.round(props.totalTime / 60), // 분
            tollFee: props.totalFare || 0, // 톨비 (원)
            fuelCost: props.taxiFare || 0, // 택시요금 (참고용)
        };
    } catch (err) {
        console.error('경로 탐색 실패:', err);
        return null;
    }
};

/**
 * 목적지 문자열을 쉼표로 분리하여 배열로 반환
 * @param {string} text - 쉼표로 구분된 목적지 문자열
 * @returns {string[]} 최대 5곳, 빈 문자열 제거
 */
export const MAX_DESTINATIONS = 5;
export const parseDestinations = (text) => {
    if (!text?.trim()) return [];
    return text.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_DESTINATIONS);
};

/**
 * 주소로 경로 탐색 (원스톱)
 * 출발지 주소와 도착지 주소를 받아 지오코딩 후 경로 탐색
 * @param {string} startAddress - 출발지 주소
 * @param {string} endAddress - 도착지 주소
 * @returns {Promise<{distance: number, duration: number, tollFee: number, startCoord: object, endCoord: object} | null>}
 */
export const getRouteByAddress = async (startAddress, endAddress, { carType = '0' } = {}) => {
    if (!startAddress?.trim() || !endAddress?.trim()) return null;

    const [startCoord, endCoord] = await Promise.all([
        geocode(startAddress),
        geocode(endAddress),
    ]);

    if (!startCoord || !endCoord) return null;

    const route = await getRoute(startCoord.lon, startCoord.lat, endCoord.lon, endCoord.lat, { carType });
    if (!route) return null;

    return {
        ...route,
        startCoord,
        endCoord,
    };
};

/**
 * 다중 목적지 경로 탐색 (회사 → 목적지1 → 목적지2 → ... → 회사)
 * 단일 목적지면 기존 getRouteByAddress와 동일 동작
 * @param {string} origin - 출발지 주소 (회사)
 * @param {string} destinationText - 쉼표 구분 목적지 문자열
 * @param {{ carType?: string }} options
 * @returns {Promise<{ distance: number, duration: number, tollFee: number, isMulti: boolean } | null>}
 *   - distance: 전체 합산 km (왕복 포함)
 *   - duration: 편도 합산 분 (복귀 제외 → calcEndTime 호환)
 *   - tollFee: 전체 합산 톨비
 */
export const getMultiRoute = async (origin, destinationText, { carType = '0' } = {}) => {
    const dests = parseDestinations(destinationText);
    if (dests.length === 0 || !origin?.trim()) return null;

    // 단일 목적지 → 기존과 동일
    if (dests.length === 1) {
        const result = await getRouteByAddress(origin, dests[0], { carType });
        if (!result) return null;
        return { ...result, isMulti: false };
    }

    // 다중 목적지: 모든 지점 지오코딩
    const allAddresses = [origin, ...dests];
    const coords = await Promise.all(allAddresses.map(addr => geocode(addr)));
    if (coords.some(c => !c)) return null;

    // 구간별 경로 탐색: origin→dest1, dest1→dest2, ..., destN→origin
    const segments = [];
    for (let i = 0; i < coords.length; i++) {
        const from = coords[i];
        const to = coords[(i + 1) % coords.length]; // 마지막은 origin으로 복귀
        const seg = await getRoute(from.lon, from.lat, to.lon, to.lat, { carType });
        if (!seg) return null;
        segments.push({
            from: allAddresses[i],
            to: allAddresses[(i + 1) % allAddresses.length],
            distance: seg.distance,
            duration: seg.duration,
            tollFee: seg.tollFee || 0,
        });
    }

    // 편도 합산 = 복귀 구간 제외 (calcEndTime이 *2+60 하므로)
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

/**
 * TMap 경로 안내 딥링크 생성
 * 다중 목적지일 때 첫 번째 목적지를 goal로 설정하여 순차 안내
 * @param {string} destination - 목적지 이름 (쉼표 구분 가능)
 * @returns {Promise<string>} TMap 딥링크 URL
 */
export const getTmapDeeplink = async (destination) => {
    if (!destination) return 'tmap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'tmap://open';

    // 첫 번째 목적지를 goal로 설정
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
        console.warn('TMap 딥링크 생성 실패, 검색으로 대체:', e);
    }
    return `tmap://route?goalname=${encodeURIComponent(goalName)}`;
};

/**
 * TMap API 키 존재 여부 확인 (프로덕션에서는 프록시로 항상 사용 가능)
 */
export const isTmapAvailable = () => import.meta.env.PROD || !!TMAP_API_KEY;

/**
 * 네이버 지도 경로 안내 딥링크 생성
 * 경유지 최대 5개 지원 (v1~v5)
 * @param {string} destination - 목적지 이름 (쉼표 구분 가능)
 * @returns {Promise<string>} 네이버 지도 딥링크 URL
 */
export const getNaverMapDeeplink = async (destination) => {
    if (!destination) return 'nmap://actionPath?appname=vehicle-log';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'nmap://actionPath?appname=vehicle-log';

    try {
        const coords = await Promise.all(dests.map(d => geocode(d)));

        // 마지막 목적지 = 최종 도착지
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'nmap://actionPath?appname=vehicle-log';

        let url = `nmap://navigation?dlat=${goalCoord.lat}&dlng=${goalCoord.lon}&dname=${encodeURIComponent(dests[goalIdx])}&appname=vehicle-log`;

        // 경유지 추가 (v1~v5)
        for (let i = 0; i < Math.min(goalIdx, 5); i++) {
            if (coords[i]) {
                url += `&v${i + 1}lat=${coords[i].lat}&v${i + 1}lng=${coords[i].lon}&v${i + 1}name=${encodeURIComponent(dests[i])}`;
            }
        }

        return url;
    } catch (e) {
        console.warn('네이버 지도 딥링크 생성 실패:', e);
    }
    return 'nmap://actionPath?appname=vehicle-log';
};

/**
 * 카카오맵 경로 안내 딥링크 생성
 * @param {string} destination - 목적지 이름 (쉼표 구분 가능)
 * @returns {Promise<string>} 카카오맵 딥링크 URL
 */
export const getKakaoMapDeeplink = async (destination) => {
    if (!destination) return 'kakaomap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'kakaomap://open';

    try {
        const coords = await Promise.all(dests.map(d => geocode(d)));

        // 마지막 목적지 = 최종 도착지
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'kakaomap://open';

        let url = `kakaomap://route?ep=${goalCoord.lat},${goalCoord.lon}&by=CAR`;

        // 경유지 (카카오맵은 좌표만)
        for (let i = 0; i < goalIdx; i++) {
            if (coords[i]) {
                url += `&wp${i + 1}=${coords[i].lat},${coords[i].lon}`;
            }
        }

        return url;
    } catch (e) {
        console.warn('카카오맵 딥링크 생성 실패:', e);
    }
    return 'kakaomap://open';
};

/**
 * 통합 내비게이션 딥링크 생성
 * @param {'tmap' | 'naver' | 'kakao'} app - 사용할 지도 앱
 * @param {string} destination - 목적지 이름 (쉼표 구분 가능)
 * @returns {Promise<string>} 딥링크 URL
 */
export const getNavigationDeeplink = async (app, destination) => {
    switch (app) {
        case 'naver': return getNaverMapDeeplink(destination);
        case 'kakao': return getKakaoMapDeeplink(destination);
        case 'tmap':
        default: return getTmapDeeplink(destination);
    }
};
