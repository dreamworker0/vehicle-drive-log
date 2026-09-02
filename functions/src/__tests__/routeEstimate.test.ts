/**
 * routeEstimate.test.ts — TMAP 편도 소요시간 추정 + 종료시간 계산
 * TMAP HTTP 호출은 global.fetch mock으로, L2 캐시(Firestore)는 인메모리 문서 맵으로 대체.
 */
jest.mock('firebase-functions/params', () => ({
    defineString: () => ({ value: () => 'test-key' }),
    defineSecret: () => ({ value: () => 'test-secret' }),
}));

// ── L2 캐시(tmapCache) Firestore mock ──
// 문서 ID → 저장된 데이터. 실제 Firestore 대신 이 맵이 캐시 역할을 한다.
const l2Docs = new Map<string, Record<string, unknown>>();
const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: (id: string) => ({
                get: async () => mockDocGet(name, id),
                set: async (data: Record<string, unknown>) => mockDocSet(name, id, data),
            }),
        }),
    }),
}));

// 적중률 측정용 구조화 로그를 여기서 검증한다 — 이 로그가 측정 수단 자체다.
const mockLog = jest.fn();
jest.mock('../utils/helpers', () => ({ log: (...args: unknown[]) => mockLog(...args) }));

import { estimateOneWayDurationMin, calcEndTimeFromDuration, __resetRouteEstimateCache } from '../services/tmap/routeEstimate';

/** 마지막 추정 로그의 extra(출처·호출 수) */
function lastTrace(): Record<string, unknown> {
    const calls = mockLog.mock.calls.filter((c) => c[1] === 'routeEstimate');
    return calls[calls.length - 1]?.[3] as Record<string, unknown>;
}

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
        l2Docs.clear();
        // 기본 L2는 진짜 캐시처럼 동작한다(쓴 것이 읽힌다). 미스·오류는 개별 케이스에서 덮어쓴다.
        mockDocGet.mockImplementation(async (_c: string, id: string) => ({
            exists: l2Docs.has(id),
            data: () => l2Docs.get(id),
        }));
        mockDocSet.mockImplementation(async (_c: string, id: string, data: Record<string, unknown>) => {
            l2Docs.set(id, data);
        });
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

    it('인스턴스가 바뀌어도 L2(Firestore)에 남아 있으면 TMAP을 다시 부르지 않는다', async () => {
        // 봇 트래픽은 띄엄띄엄해 콜드 스타트가 잦다. L1만 있으면 그때마다 캐시가 통째로 날아간다.
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3);

        __resetRouteEstimateCache(); // 인스턴스 재활용 — L1만 날아가고 L2는 남는다

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('L2에 만료 시각을 함께 적는다 — TTL 정책이 그 필드를 보고 지운다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        await estimateOneWayDurationMin('서울시 중구', '서울역');

        expect(mockDocSet).toHaveBeenCalled();
        for (const [collection, , data] of mockDocSet.mock.calls) {
            expect(collection).toBe('tmapCache');
            // Date로 써야 Firestore가 timestamp로 저장하고 TTL 정책이 인식한다
            expect((data as { expiresAt: unknown }).expiresAt).toBeInstanceOf(Date);
            expect((data as { expiresAt: Date }).expiresAt.getTime()).toBeGreaterThan(Date.now());
        }
    });

    it('L2 문서가 만료됐으면 무시하고 다시 조회한다', async () => {
        mockDocGet.mockImplementation(async () => ({
            exists: true,
            data: () => ({ value: { lat: 1, lon: 1 }, expiresAt: new Date(Date.now() - 1000) }),
        }));
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
        expect(mockFetch).toHaveBeenCalledTimes(3); // 만료분을 쓰지 않았다
    });

    it('L2가 죽어도 추정은 계속된다 — 캐시는 있으면 좋은 것이지 필수가 아니다', async () => {
        mockDocGet.mockRejectedValue(new Error('firestore 불가'));
        mockDocSet.mockRejectedValue(new Error('firestore 불가'));
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.55', '126.97')))
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        expect(await estimateOneWayDurationMin('서울시 중구', '서울역')).toBe(30);
    });

    it('캐시 출처와 실제 TMAP 호출 수를 로그로 남긴다 — 적중률을 이 로그로 집계한다', async () => {
        // 캐시를 넣었으면 값을 하는지도 봐야 한다. 인스턴스 카운터로는 재활용 시 사라지므로
        // 호출마다 구조화 로그를 남기고 집계는 Cloud Logging에 맡긴다.
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        // 1회차: 좌표 재사용 + 목적지·경로는 API
        await estimateOneWayDurationMin({ address: '서울시 중구', lat: 37.55, lng: 126.97 }, '서울역');
        expect(lastTrace()).toEqual({ origin: 'coord', destination: 'api', route: 'api', tmapCalls: 2 });

        // 2회차: 같은 인스턴스이므로 L1이 받는다 — TMAP 호출 0
        await estimateOneWayDurationMin({ address: '서울시 중구', lat: 37.55, lng: 126.97 }, '서울역');
        expect(lastTrace()).toEqual({ origin: 'coord', destination: 'l1', route: 'l1', tmapCalls: 0 });

        // 3회차: 인스턴스 재활용 후 — L2가 받는다. 이 줄이 L2의 존재 가치를 보여주는 값이다.
        __resetRouteEstimateCache();
        await estimateOneWayDurationMin({ address: '서울시 중구', lat: 37.55, lng: 126.97 }, '서울역');
        expect(lastTrace()).toEqual({ origin: 'coord', destination: 'l2', route: 'l2', tmapCalls: 0 });
    });

    it('실패한 추정도 로그를 남긴다 — 실패분을 빼면 적중률이 실제보다 좋아 보인다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, { searchPoiInfo: { pois: {} } }))
            .mockResolvedValueOnce(res(true, { coordinateInfo: {} }));

        expect(await estimateOneWayDurationMin('알수없는주소', '서울역')).toBeNull();

        // 지오코딩 폴백까지 2회가 실측으로 잡힌다(POI + fullAddrGeo)
        expect(lastTrace()).toMatchObject({ origin: 'api', tmapCalls: 2 });
    });

    it('주소·목적지 문자열은 로그에 넣지 않는다 — 기관 주소와 방문지는 그렇게 다룬다', async () => {
        mockFetch
            .mockResolvedValueOnce(res(true, POI('37.51', '127.06')))
            .mockResolvedValueOnce(res(true, ROUTE(1800)));

        await estimateOneWayDurationMin({ address: '서울시 중구 세종대로 110', lat: 37.55, lng: 126.97 }, '국립중앙의료원');

        const serialized = JSON.stringify(mockLog.mock.calls);
        expect(serialized).not.toContain('세종대로');
        expect(serialized).not.toContain('국립중앙의료원');
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
