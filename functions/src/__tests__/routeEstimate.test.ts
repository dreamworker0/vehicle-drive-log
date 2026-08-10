/**
 * routeEstimate.test.ts — TMAP 편도 소요시간 추정 + 종료시간 계산
 * TMAP HTTP 호출은 global.fetch mock으로 대체.
 */
jest.mock('firebase-functions/params', () => ({
    defineString: () => ({ value: () => 'test-key' }),
}));

import { estimateOneWayDurationMin, calcEndTimeFromDuration, __resetRouteEstimateCache } from '../services/tmap/routeEstimate';

function res(ok: boolean, body: unknown) {
    return { ok, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
const POI = (lat: string, lon: string) => ({ searchPoiInfo: { pois: { poi: [{ noorLat: lat, noorLon: lon }] } } });
const ROUTE = (totalTime: number) => ({ features: [{ properties: { totalTime } }] });

const mockFetch = jest.fn();

describe('estimateOneWayDurationMin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // 캐시는 모듈 스코프라 케이스 간 결과가 새어 나간다 — 호출 횟수 검증이 무의미해지지 않도록 비운다.
        __resetRouteEstimateCache();
        (global as unknown as { fetch: unknown }).fetch = mockFetch;
    });

    it('출발/목적지 POI + 경로가 성공하면 분 단위 소요시간을 반환한다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))  // origin POI
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))  // dest POI
            .mockResolvedValueOnce(res(true, ROUTE(1800)));            // route: 1800s = 30분

        const min = await estimateOneWayDurationMin('서울시 중구', '서울역');

        expect(min).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('출발지 지오코딩(POI+주소) 모두 실패하면 null을 반환한다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, { searchPoiInfo: { pois: {} } })) // POI 없음
            .mockResolvedValueOnce(res(true, { coordinateInfo: {} }));         // fullAddrGeo 없음

        const min = await estimateOneWayDurationMin('알수없는주소', '서울역');

        expect(min).toBeNull();
    });

    it('경로 탐색이 실패하면 null을 반환한다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(false, ''));  // route 오류

        const min = await estimateOneWayDurationMin('서울시 중구', '서울역');

        expect(min).toBeNull();
    });

    it('기관 주소가 없으면 호출 없이 null을 반환한다', async () => {
        const min = await estimateOneWayDurationMin(undefined, '서울역');
        expect(min).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('목적지가 비면 null을 반환한다', async () => {
        const min = await estimateOneWayDurationMin('서울시 중구', '');
        expect(min).toBeNull();
    });

    it('출발지 좌표가 있으면 출발지 지오코딩을 건너뛴다 (3회 → 2회)', async () => {
        // 기관 문서에는 lat/lng가 이미 저장돼 있다. 그걸 두고 주소로 다시 조회하는 건
        // 결과가 정해진 TMAP 호출을 매 대화마다 낭비하는 것이다.
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))  // dest POI만
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        const min = await estimateOneWayDurationMin({ address: '서울시 중구', lat: 37.55, lng: 126.97 }, '서울역');

        expect(min).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('좌표가 없는 기관은 주소로 폴백한다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        const min = await estimateOneWayDurationMin({ address: '서울시 중구' }, '서울역');

        expect(min).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('주소도 좌표도 없으면 호출 없이 null을 반환한다', async () => {
        expect(await estimateOneWayDurationMin({}, '서울역')).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('같은 출발지·목적지를 다시 물으면 캐시로 답해 TMAP을 재호출하지 않는다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3);

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3); // 늘지 않는다
    });

    it('지오코딩 실패도 캐시한다 — 오타 주소를 매번 두 번씩 다시 묻지 않는다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, { searchPoiInfo: { pois: {} } }))
            .mockResolvedValueOnce(res(true, { coordinateInfo: {} }));

        expect(await estimateOneWayDurationMin('알수없는주소', '서울역')).toBeNull();
        expect(mockFetch).toHaveBeenCalledTimes(2);

        expect(await estimateOneWayDurationMin('알수없는주소', '서울역')).toBeNull();
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});

describe('calcEndTimeFromDuration', () => {
    it('왕복(×2) + 여유 1시간으로 종료를 계산한다 (30분 → +2시간)', () => {
        // 30*2 + 60 = 120분 → 14:00 + 2:00 = 16:00
        expect(calcEndTimeFromDuration('14:00', 30)).toBe('16:00');
    });

    it('소요 0이면 +1시간이다', () => {
        expect(calcEndTimeFromDuration('09:00', 0)).toBe('10:00');
    });

    it('10분 단위로 올림한다 (25분 → 왕복50+60=110 → 110)', () => {
        // 25*2+60 = 110 → 10분 올림 110 → 09:00 + 1:50 = 10:50
        expect(calcEndTimeFromDuration('09:00', 25)).toBe('10:50');
    });

    it('자정을 넘으면 23:59로 상한 처리한다', () => {
        expect(calcEndTimeFromDuration('23:00', 60)).toBe('23:59');
    });
});
