/**
 * tmap/routing.test.ts — 경로 탐색 테스트
 *
 * 여기서 나온 거리·시간·통행료가 예약 화면과 비용 비교에 그대로 노출된다.
 * 단위 변환(m→km, 초→분)과 다중 목적지 편도 합산(복귀 구간 제외)이 핵심 회귀 지점이다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settle, routeResponse, okJson } from './tmapHarness';

vi.mock('../../../lib/authFetch', () => ({
    getAuthHeaders: vi.fn(async () => ({})),
}));

let routing: typeof import('../../../lib/tmap/routing');
let core: typeof import('../../../lib/tmap/core');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_TMAP_API_KEY', 'test-key');
    vi.resetModules();
    core = await import('../../../lib/tmap/core');
    routing = await import('../../../lib/tmap/routing');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

function respondWith(...payloads: unknown[]) {
    payloads.forEach(p => fetchMock.mockResolvedValueOnce(okJson(p)));
}

/** 주소별 좌표를 미리 캐시에 심어 지오코딩 호출을 건너뛴다 */
function seedCoords(map: Record<string, [number, number]>) {
    for (const [addr, [lat, lon]] of Object.entries(map)) {
        core.geoCache.set(addr, { lat, lon, name: addr });
    }
}

const ROUTE_10KM = routeResponse({ totalDistance: 10_000, totalTime: 1_800, totalFare: 1_200, taxiFare: 9_000 });

describe('getRoute', () => {
    it('미터·초 단위를 km·분으로 변환한다', async () => {
        respondWith(routeResponse({ totalDistance: 12_500, totalTime: 3_030, totalFare: 2_400, taxiFare: 15_000 }));

        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6))).resolves.toEqual({
            distance: 12,     // 12,500m → 12km (내림)
            duration: 51,     // 3,030초 → 50.5분 → 51분 (반올림)
            tollFee: 2_400,
            fuelCost: 15_000,
        });
    });

    it('통행료·유류비가 없으면 0으로 채운다', async () => {
        respondWith(routeResponse({ totalDistance: 5_000, totalTime: 600 }));

        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6)))
            .resolves.toMatchObject({ tollFee: 0, fuelCost: 0 });
    });

    it('1km 미만은 0km로 표기한다', async () => {
        respondWith(routeResponse({ totalDistance: 800, totalTime: 120 }));

        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6)))
            .resolves.toMatchObject({ distance: 0, duration: 2 });
    });

    it('쿨다운 중이면 호출 없이 null', async () => {
        core.recordFail(true);

        await expect(routing.getRoute(127.0, 37.5, 127.1, 37.6)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('개발 환경에서 API 키가 없으면 호출 없이 null', async () => {
        vi.stubEnv('VITE_TMAP_API_KEY', '');
        vi.resetModules();
        const noKey = await import('../../../lib/tmap/routing');

        await expect(noKey.getRoute(127.0, 37.5, 127.1, 37.6)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('경로가 없으면 null을 캐시해 재조회를 막는다', async () => {
        respondWith({ features: [] });

        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6))).resolves.toBeNull();

        const callCount = fetchMock.mock.calls.length;
        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6))).resolves.toBeNull();
        expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it('예외가 나면 null을 반환하되 캐시하지는 않는다 (일시 장애 재시도 허용)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' });

        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6))).resolves.toBeNull();

        respondWith(ROUTE_10KM);
        await expect(settle(routing.getRoute(127.0, 37.5, 127.1, 37.6)))
            .resolves.toMatchObject({ distance: 10 });
    });

    it('같은 좌표·옵션은 캐시에서 돌려준다', async () => {
        respondWith(ROUTE_10KM);

        const first = await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6));
        const callCount = fetchMock.mock.calls.length;
        const second = await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6));

        expect(second).toEqual(first);
        expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it('carType이 다르면 별도 캐시다 (경차 톨비 할인 반영)', async () => {
        respondWith(
            routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 2_000 }),
            routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 1_000 }),
        );

        const sedan = await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6, { carType: '1' }));
        const compact = await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6, { carType: '6' }));

        expect(sedan?.tollFee).toBe(2_000);
        expect(compact?.tollFee).toBe(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('searchOption이 다르면 별도 캐시다 (무료도로 비교)', async () => {
        respondWith(
            routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 2_000 }),
            routeResponse({ totalDistance: 14_000, totalTime: 900, totalFare: 0 }),
        );

        await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6, { searchOption: '0' }));
        const free = await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6, { searchOption: '1' }));

        expect(free).toMatchObject({ distance: 14, tollFee: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('좌표를 소수점 5자리로 정규화해 미세한 차이는 같은 캐시로 본다', async () => {
        respondWith(ROUTE_10KM);

        await settle(routing.getRoute(127.000001, 37.5, 127.1, 37.6));
        const callCount = fetchMock.mock.calls.length;
        await settle(routing.getRoute(127.000002, 37.5, 127.1, 37.6));

        expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it('요청 본문에 WGS84 좌표계와 옵션을 담는다', async () => {
        respondWith(ROUTE_10KM);

        await settle(routing.getRoute(127.0, 37.5, 127.1, 37.6, { carType: '6', searchOption: '1' }));

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            startX: '127', startY: '37.5', endX: '127.1', endY: '37.6',
            reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO',
            searchOption: '1', carType: '6',
        });
    });
});

describe('getRouteByAddress', () => {
    it('출발·도착 주소를 좌표로 바꿔 경로를 조회하고 좌표를 함께 반환한다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith(ROUTE_10KM);

        const result = await settle(routing.getRouteByAddress('기관', '시청'));

        expect(result).toMatchObject({
            distance: 10,
            duration: 30,
            startCoord: { lat: 37.5, lon: 127.0 },
            endCoord: { lat: 37.6, lon: 127.1 },
        });
    });

    it('주소가 비어 있으면 호출 없이 null', async () => {
        await expect(routing.getRouteByAddress('', '시청')).resolves.toBeNull();
        await expect(routing.getRouteByAddress('기관', '  ')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('한쪽 좌표를 못 찾으면 경로를 조회하지 않는다', async () => {
        seedCoords({ '기관': [37.5, 127.0] });
        core.geoCache.set('없는곳', null);

        await expect(settle(routing.getRouteByAddress('기관', '없는곳'))).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('경로 조회가 실패하면 null', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith({ features: [] });

        await expect(settle(routing.getRouteByAddress('기관', '시청'))).resolves.toBeNull();
    });
});

describe('getMultiRoute', () => {
    it('목적지가 없거나 출발지가 비면 null', async () => {
        await expect(routing.getMultiRoute('기관', '')).resolves.toBeNull();
        await expect(routing.getMultiRoute('', '시청')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('목적지가 하나면 단일 경로로 처리하고 isMulti=false', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith(ROUTE_10KM);

        const result = await settle(routing.getMultiRoute('기관', '시청'));

        expect(result).toMatchObject({ isMulti: false, distance: 10 });
    });

    it('목적지가 여럿이면 복귀 구간을 뺀 편도 합계를 낸다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1], '병원': [37.7, 127.2] });
        respondWith(
            routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 1_000 }),   // 기관→시청
            routeResponse({ totalDistance: 20_000, totalTime: 1_200, totalFare: 2_000 }), // 시청→병원
            routeResponse({ totalDistance: 25_000, totalTime: 1_500, totalFare: 3_000 }), // 병원→기관 (복귀, 합계 제외)
        );

        const result = await settle(routing.getMultiRoute('기관', '시청, 병원'));

        expect(result).toMatchObject({
            isMulti: true,
            distance: 30,   // 10 + 20 (복귀 25 제외)
            duration: 30,   // 10 + 20분
            tollFee: 3_000, // 1,000 + 2,000 (복귀 3,000 제외)
        });
    });

    it('구간 목록에는 복귀 구간까지 포함해 노선을 보여준다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1], '병원': [37.7, 127.2] });
        respondWith(
            routeResponse({ totalDistance: 10_000, totalTime: 600 }),
            routeResponse({ totalDistance: 20_000, totalTime: 1_200 }),
            routeResponse({ totalDistance: 25_000, totalTime: 1_500 }),
        );

        const result = await settle(routing.getMultiRoute('기관', '시청, 병원'));

        expect(result?.segments).toHaveLength(3);
        expect(result?.segments?.map(s => [s.from, s.to])).toEqual([
            ['기관', '시청'], ['시청', '병원'], ['병원', '기관'],
        ]);
    });

    it('좌표를 하나라도 못 찾으면 경로를 조회하지 않는다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '병원': [37.7, 127.2] });
        core.geoCache.set('시청', null);

        await expect(settle(routing.getMultiRoute('기관', '시청, 병원'))).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('구간 하나라도 경로 조회에 실패하면 null', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1], '병원': [37.7, 127.2] });
        respondWith(
            routeResponse({ totalDistance: 10_000, totalTime: 600 }),
            { features: [] },
            routeResponse({ totalDistance: 25_000, totalTime: 1_500 }),
        );

        await expect(settle(routing.getMultiRoute('기관', '시청, 병원'))).resolves.toBeNull();
    });
});

describe('getRouteInfo', () => {
    it('거리와 소요 시간만 추려서 돌려준다', async () => {
        seedCoords({ '시청': [37.5, 127.0] });
        respondWith(routeResponse({ totalDistance: 8_000, totalTime: 900, totalFare: 500 }));

        await expect(settle(routing.getRouteInfo('시청'))).resolves.toEqual({ distance: 8, duration: 15 });
    });

    it('좌표를 못 찾으면 null', async () => {
        core.geoCache.set('없는곳', null);

        await expect(settle(routing.getRouteInfo('없는곳'))).resolves.toBeNull();
    });
});

describe('getMultiRouteWithFreeRoad', () => {
    it('통행료가 있으면 hasToll을 켜서 무료도로 비교 UI를 노출시킨다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith(routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 1_800 }));

        const result = await settle(routing.getMultiRouteWithFreeRoad('기관', '시청'));

        expect(result).toMatchObject({ hasToll: true, tollFee: 1_800 });
        expect(result?.freeRoadRoute).toBeUndefined(); // 무료도로는 on-demand로만 조회
    });

    it('통행료가 0이면 hasToll을 끈다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith(routeResponse({ totalDistance: 10_000, totalTime: 600, totalFare: 0 }));

        await expect(settle(routing.getMultiRouteWithFreeRoad('기관', '시청')))
            .resolves.toMatchObject({ hasToll: false });
    });

    it('경로를 못 찾으면 null', async () => {
        core.geoCache.set('없는곳', null);

        await expect(settle(routing.getMultiRouteWithFreeRoad('기관', '없는곳'))).resolves.toBeNull();
    });
});

describe('getFreeRoadRoute', () => {
    it('무료도로 옵션(searchOption=1)으로 조회한다', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith(routeResponse({ totalDistance: 14_000, totalTime: 1_500, totalFare: 0 }));

        const result = await settle(routing.getFreeRoadRoute('기관', '시청'));

        expect(result).toEqual({ distance: 14, duration: 25, tollFee: 0 });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).searchOption).toBe('1');
    });

    it('쿨다운 중이면 호출 없이 null', async () => {
        core.recordFail(true);

        await expect(routing.getFreeRoadRoute('기관', '시청')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('경로를 못 찾으면 null', async () => {
        seedCoords({ '기관': [37.5, 127.0], '시청': [37.6, 127.1] });
        respondWith({ features: [] });

        await expect(settle(routing.getFreeRoadRoute('기관', '시청'))).resolves.toBeNull();
    });
});

/**
 * 이 PR의 전부는 "드롭다운이 심은 키"와 "geocode가 받는 문자열"이 같다는 것이다.
 * 어긋나면 아무 일도 하지 않고 조용히 예전처럼 API를 부른다 — 실패가 눈에 안 보이는
 * 종류라, 사슬 전체를 태우는 회귀 가드를 둔다.
 *
 * 사슬: DestinationInput이 만드는 `"이름 (주소)"` → onChangeDestination →
 *       form.destination(`', '` join) → parseDestinations(split) → getMultiRoute → geocode
 */
describe('primeGeocodeCache 사슬 — 고른 목적지는 다시 검색하지 않는다', () => {
    /** DestinationInput의 라벨 생성 규칙과 같은 모양 */
    const label = (name: string, address: string) => `${name} (${address})`;

    it('목적지 하나: 출발지만 지오코딩하고 목적지는 캐시로 끝난다', async () => {
        const geo = await import('../../../lib/tmap/geocoding');
        const dest = label('사천동주민센터', '경남 사천시 대방로');
        geo.primeGeocodeCache(dest, { lat: 35.0, lon: 128.0, name: '사천동주민센터' });
        seedCoords({ '기관 주소': [35.1, 128.1] });

        respondWith(routeResponse({ totalDistance: 10000, totalTime: 600 }));
        const result = await settle(routing.getMultiRoute('기관 주소', dest));

        expect(result).not.toBeNull();
        // 경로 1건만 나가고 POI 검색은 아예 없다
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('routes');
    });

    it('목적지 둘: ", " join/split을 왕복해도 키가 살아 있다', async () => {
        const geo = await import('../../../lib/tmap/geocoding');
        const a = label('사천동주민센터', '경남 사천시 대방로');
        const b = label('삼천포병원', '경남 사천시 중앙로');
        geo.primeGeocodeCache(a, { lat: 35.0, lon: 128.0, name: '사천동주민센터' });
        geo.primeGeocodeCache(b, { lat: 35.05, lon: 128.05, name: '삼천포병원' });
        seedCoords({ '기관 주소': [35.1, 128.1] });

        // 다중 목적지는 구간 수만큼 경로를 부른다 (출발→A→B→출발)
        respondWith(
            routeResponse({ totalDistance: 5000, totalTime: 300 }),
            routeResponse({ totalDistance: 3000, totalTime: 200 }),
            routeResponse({ totalDistance: 7000, totalTime: 400 }),
        );

        // 폼에 저장되는 모양 그대로 넘긴다
        const result = await settle(routing.getMultiRoute('기관 주소', [a, b].join(', ')));

        expect(result).not.toBeNull();
        expect(result!.isMulti).toBe(true);
        // POI 검색이 한 건도 나가지 않았다
        const poiCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('pois'));
        expect(poiCalls).toHaveLength(0);
    });

    it('심지 않은 목적지는 예전처럼 검색한다 (빗나가도 깨지지 않는다)', async () => {
        seedCoords({ '기관 주소': [35.1, 128.1] });
        respondWith(
            { searchPoiInfo: { pois: { poi: [{ noorLat: '35.0', noorLon: '128.0', name: '직접입력한곳' }] } } },
            routeResponse({ totalDistance: 10000, totalTime: 600 }),
        );

        const result = await settle(routing.getMultiRoute('기관 주소', '직접입력한곳'));

        expect(result).not.toBeNull();
        const poiCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('pois'));
        expect(poiCalls).toHaveLength(1);
    });
});
