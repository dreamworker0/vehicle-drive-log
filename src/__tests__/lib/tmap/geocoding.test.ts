/**
 * tmap/geocoding.test.ts — POI 검색 / 주소→좌표 변환 테스트
 *
 * geocode는 "괄호 주소 전처리 → POI(주소) → POI(장소명) → 지오코딩 API" 3단 폴백이라
 * 한 단계만 어긋나도 특정 형태의 목적지만 조용히 좌표를 못 찾는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settle, poiResponse, geoResponse, okJson } from './tmapHarness';

// authFetch는 firebase 초기화를 끌고 오므로 차단한다 (PROD 경로에서만 쓰인다)
vi.mock('../../../lib/authFetch', () => ({
    getAuthHeaders: vi.fn(async () => ({})),
}));

let geo: typeof import('../../../lib/tmap/geocoding');
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
    geo = await import('../../../lib/tmap/geocoding');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

/** 순서대로 응답할 T-Map 페이로드를 등록한다 */
function respondWith(...payloads: unknown[]) {
    payloads.forEach(p => fetchMock.mockResolvedValueOnce(okJson(p)));
}

const SEOUL_CITY_HALL = { noorLat: '37.5663', noorLon: '126.9779', name: '서울시청' };

describe('searchPOI', () => {
    it('검색어가 2글자 미만이면 호출하지 않는다', async () => {
        await expect(geo.searchPOI('시')).resolves.toBeNull();
        await expect(geo.searchPOI('')).resolves.toBeNull();
        await expect(geo.searchPOI('  ')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('첫 번째 POI의 좌표와 이름을 반환한다', async () => {
        respondWith(poiResponse(SEOUL_CITY_HALL, { noorLat: '1', noorLon: '2', name: '무시됨' }));

        await expect(settle(geo.searchPOI('서울시청'))).resolves.toEqual({
            lat: 37.5663, lon: 126.9779, name: '서울시청',
        });
    });

    it('POI 이름이 없으면 검색어를 이름으로 쓴다', async () => {
        respondWith(poiResponse({ noorLat: '37.5', noorLon: '127.0' }));

        await expect(settle(geo.searchPOI('어딘가'))).resolves.toMatchObject({ name: '어딘가' });
    });

    it('검색 결과가 없으면 null', async () => {
        respondWith(poiResponse());
        await expect(settle(geo.searchPOI('없는곳'))).resolves.toBeNull();
    });

    it('예외가 나도 삼키고 null을 반환한다', async () => {
        fetchMock.mockRejectedValue(new Error('network'));
        await expect(settle(geo.searchPOI('서울시청'))).resolves.toBeNull();
    });

    it('검색어를 URL 인코딩해 전달한다', async () => {
        respondWith(poiResponse(SEOUL_CITY_HALL));

        await settle(geo.searchPOI('서울 시청'));

        expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('서울 시청'));
    });
});

describe('searchPOIList', () => {
    it('2글자 미만이면 빈 배열', async () => {
        await expect(geo.searchPOIList('시')).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('좌표가 있는 항목만 후보로 만든다', async () => {
        respondWith(poiResponse(
            { noorLat: '37.5', noorLon: '127.0', name: '유효', upperAddrName: '서울', middleAddrName: '중구', roadName: '세종대로' },
            { name: '좌표없음' },
        ));

        const list = await settle(geo.searchPOIList('시청'));
        expect(list).toHaveLength(1);
        expect(list[0]).toEqual({ lat: 37.5, lon: 127.0, name: '유효', address: '서울 중구 세종대로' });
    });

    it('도로명이 없으면 법정동명으로 주소를 만든다', async () => {
        respondWith(poiResponse(
            { noorLat: '37.5', noorLon: '127.0', name: '기관', upperAddrName: '서울', middleAddrName: '용산구', lowerAddrName: '청파동' },
        ));

        const list = await settle(geo.searchPOIList('기관'));
        expect(list[0].address).toBe('서울 용산구 청파동');
    });

    it('주소 조각이 없으면 빈 주소로 둔다', async () => {
        respondWith(poiResponse({ noorLat: '37.5', noorLon: '127.0', name: '기관' }));

        const list = await settle(geo.searchPOIList('기관'));
        expect(list[0].address).toBe('');
    });

    it('응답이 배열이 아니면 빈 배열', async () => {
        respondWith({ searchPoiInfo: { pois: { poi: null } } });
        await expect(settle(geo.searchPOIList('시청'))).resolves.toEqual([]);
    });

    it('예외가 나도 빈 배열을 반환한다', async () => {
        fetchMock.mockRejectedValue(new Error('network'));
        await expect(settle(geo.searchPOIList('시청'))).resolves.toEqual([]);
    });

    it('요청 개수를 URL에 반영한다 (기본 5)', async () => {
        respondWith(poiResponse(), poiResponse());

        await settle(geo.searchPOIList('시청'));
        expect(fetchMock.mock.calls[0][0]).toContain('count=5');

        await settle(geo.searchPOIList('시청', 3));
        expect(fetchMock.mock.calls[1][0]).toContain('count=3');
    });
});

describe('geocode — 입력 가드', () => {
    it('빈 값이나 1글자는 호출 없이 null', async () => {
        await expect(geo.geocode('')).resolves.toBeNull();
        await expect(geo.geocode('시')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('쿨다운 중이면 호출 없이 null', async () => {
        core.recordFail(true);

        await expect(geo.geocode('서울시청')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('개발 환경에서 API 키가 없으면 호출 없이 null', async () => {
        vi.stubEnv('VITE_TMAP_API_KEY', '');
        vi.resetModules();
        const noKeyGeo = await import('../../../lib/tmap/geocoding');

        await expect(noKeyGeo.geocode('서울시청')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('geocode — 캐시', () => {
    it('같은 주소를 두 번 조회하면 두 번째는 네트워크를 타지 않는다', async () => {
        respondWith(poiResponse(SEOUL_CITY_HALL));

        const first = await settle(geo.geocode('서울시청'));
        const callCount = fetchMock.mock.calls.length;
        const second = await settle(geo.geocode('서울시청'));

        expect(second).toEqual(first);
        expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it('실패 결과(null)도 캐시해 재조회를 막는다', async () => {
        respondWith(poiResponse(), poiResponse());

        await settle(geo.geocode('없는주소'));
        const callCount = fetchMock.mock.calls.length;
        await expect(settle(geo.geocode('없는주소'))).resolves.toBeNull();

        expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it('캐시 히트는 쿨다운 중에도 동작한다', async () => {
        core.geoCache.set('서울시청', { lat: 37.5, lon: 127.0, name: '서울시청' });
        core.recordFail(true);

        await expect(geo.geocode('서울시청')).resolves.toEqual({ lat: 37.5, lon: 127.0, name: '서울시청' });
    });
});

describe('geocode — 3단 폴백', () => {
    it('1차: 괄호 안의 주소로 POI 검색에 성공하면 그 결과를 쓴다', async () => {
        respondWith(poiResponse({ noorLat: '37.5556', noorLon: '126.9723', name: '서울역' }));

        const result = await settle(geo.geocode('서울역 (서울 용산구 청파동3가 10-3)'));

        expect(result).toEqual({ lat: 37.5556, lon: 126.9723, name: '서울역' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('서울 용산구 청파동3가 10-3'));
    });

    it('2차: 주소 검색이 실패하면 괄호 앞 장소명으로 재시도한다', async () => {
        respondWith(
            poiResponse(),                                                              // 1차 주소 실패
            poiResponse({ noorLat: '37.5', noorLon: '127.0', name: '우리기관' }),         // 2차 장소명 성공
        );

        const result = await settle(geo.geocode('우리기관 (없는 주소 표기)'));

        expect(result).toMatchObject({ lat: 37.5, lon: 127.0 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent('우리기관'));
    });

    it('괄호가 없으면 2차 재시도를 건너뛰고 곧바로 3차로 넘어간다', async () => {
        respondWith(poiResponse(), geoResponse({ newLat: '37.1', newLon: '127.1' }));

        const result = await settle(geo.geocode('평범한주소'));

        expect(fetchMock).toHaveBeenCalledTimes(2); // POI 1회 + 지오코딩 1회 (장소명 재시도 없음)
        expect(result).toEqual({ lat: 37.1, lon: 127.1, name: '평범한주소' });
    });

    it('3차: newLat/newLon을 lat/lon보다 우선한다', async () => {
        respondWith(poiResponse(), geoResponse({ newLat: '37.9', newLon: '127.9', lat: '1', lon: '2' }));

        await expect(settle(geo.geocode('평범한주소')))
            .resolves.toEqual({ lat: 37.9, lon: 127.9, name: '평범한주소' });
    });

    it('3차: newLat이 없으면 lat/lon으로 대체한다', async () => {
        respondWith(poiResponse(), geoResponse({ lat: '36.5', lon: '128.5' }));

        await expect(settle(geo.geocode('평범한주소')))
            .resolves.toEqual({ lat: 36.5, lon: 128.5, name: '평범한주소' });
    });

    it('3차 좌표가 0이면 유효하지 않은 것으로 보고 null을 반환한다', async () => {
        respondWith(poiResponse(), geoResponse({ lat: '0', lon: '0' }));

        await expect(settle(geo.geocode('평범한주소'))).resolves.toBeNull();
    });

    it('모든 단계가 실패하면 null을 반환하고 캐시에 남긴다', async () => {
        respondWith(poiResponse(), poiResponse());

        await expect(settle(geo.geocode('없는곳'))).resolves.toBeNull();
        expect(core.geoCache.has('없는곳')).toBe(true);
        expect(core.geoCache.get('없는곳')).toBeNull();
    });

    it('성공하면 실패 카운터를 리셋한다', async () => {
        core.recordFail();
        core.recordFail();
        respondWith(poiResponse(SEOUL_CITY_HALL));

        await settle(geo.geocode('서울시청'));

        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(false); // 리셋되지 않았다면 여기서 쿨다운
    });
});
