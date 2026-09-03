/**
 * tmapProxy.test.ts — T맵 프록시의 외부 API 실패 처리
 *
 * holidayProxy가 2026-09-03에 상대 쪽 네트워크 장애로 Sentry 경보를 울렸을 때, 이 프록시도
 * 똑같이 상한 없는 맨 `fetch`였다. 발생 이력은 없었지만 같은 구조라 같은 방식으로 터진다 —
 * 여섯 개 호출부를 `fetchTmapJson` 하나로 모으고 그 계약을 여기서 고정한다.
 *
 * 고정하는 계약:
 *   1. 외부 API에 닿지 못하면 502 + WARNING (ERROR로 올리지 않는다 = 경보 없음)
 *   2. 실패 로그에 원인(undici cause code / timeout)이 남는다
 *   3. 응답 없는 상대에 묶이지 않도록 fetch에 타임아웃 시그널을 건다
 *   4. GET(geocode·poi)과 POST(route)가 같은 처리를 받는다
 *   5. 정상 응답은 그대로 통과시킨다 (route는 features[0].properties만 남긴다)
 */

const mockOnRequest = jest.fn((_opts: unknown, handler: unknown) => handler);
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (...args: unknown[]) => mockOnRequest(args[0], args[1]),
}));

jest.mock('firebase-functions/params', () => ({
    defineString: () => ({ value: () => 'TEST_KEY' }),
}));

const mockLog = jest.fn();
jest.mock('../utils/helpers', () => ({
    wrapHttps: (_name: string, handler: unknown) => handler,
    verifyAuthToken: async () => 'uid_test',
    log: (...args: unknown[]) => mockLog(...args),
}));

jest.mock('../utils/rateLimit', () => ({
    checkRateLimitBySubject: async () => false,
}));

jest.mock('../utils/constants', () => ({
    getRateLimits: async () => ({ max: 30, windowSec: 60 }),
}));

import { tmapProxy } from '../handlers/https/tmapProxy';

type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
    const res: Res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

const proxy = tmapProxy as unknown as (req: unknown, res: unknown) => Promise<void>;

/** 주소 검색(GET) 요청 */
const geocodeReq = {
    headers: { authorization: 'Bearer token' },
    path: '/',
    query: { action: 'geocode', address: '서울시청' },
};

/** 경로 계산(POST) 요청 */
const routeReq = {
    headers: { authorization: 'Bearer token' },
    path: '/',
    query: { action: 'route' },
    body: { startX: 1, startY: 2, endX: 3, endY: 4 },
};

function findLog(severity: string) {
    return mockLog.mock.calls.find(c => c[0] === severity);
}

/** undici가 만드는 모양 — message는 "fetch failed", 실제 원인은 cause에 있다 */
function networkError(code: string) {
    const err = new TypeError('fetch failed');
    (err as unknown as { cause: { code: string } }).cause = { code };
    return err;
}

describe('tmapProxy — 외부 API 실패 처리', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('연결 실패는 502로 돌려주고 ERROR가 아닌 WARNING으로 남긴다', async () => {
        global.fetch = jest.fn().mockRejectedValue(networkError('ENOTFOUND')) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(geocodeReq, res);

        expect(res.status).toHaveBeenCalledWith(502);
        // 경보가 울리면 안 된다 — log("ERROR")가 곧 captureError다
        expect(findLog('ERROR')).toBeUndefined();
        expect(findLog('WARNING')?.[3]).toMatchObject({ reason: 'ENOTFOUND' });
    });

    it('타임아웃은 원인을 timeout으로 적는다', async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        global.fetch = jest.fn().mockRejectedValue(err) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(geocodeReq, res);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(findLog('WARNING')?.[3]).toMatchObject({ reason: 'timeout' });
    });

    it('경로 계산(POST)도 같은 처리를 받는다', async () => {
        global.fetch = jest.fn().mockRejectedValue(networkError('ECONNRESET')) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(routeReq, res);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(findLog('ERROR')).toBeUndefined();
        expect(findLog('WARNING')?.[3]).toMatchObject({ reason: 'ECONNRESET' });
    });

    it('응답 없는 상대에 묶이지 않도록 타임아웃 시그널을 건다 (POST 본문도 보존)', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => JSON.stringify({ features: [{ properties: { totalDistance: 100 } }] }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        await proxy(routeReq, makeRes());

        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal; method?: string; body?: string };
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify(routeReq.body));
    });

    it('정상 응답은 그대로 통과시킨다', async () => {
        const payload = { coordinateInfo: { coordinate: [{ lat: '37.5', lon: '127.0' }] } };
        global.fetch = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => JSON.stringify(payload),
        }) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(geocodeReq, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(payload);
        expect(findLog('WARNING')).toBeUndefined();
    });

    it('경로 계산 응답은 features[0].properties만 남긴다', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => JSON.stringify({
                features: [
                    { properties: { totalDistance: 100 }, geometry: { coordinates: [[1, 2]] } },
                    { properties: { x: 1 } },
                ],
            }),
        }) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(routeReq, res);

        expect(res.json).toHaveBeenCalledWith({ features: [{ properties: { totalDistance: 100 } }] });
    });

    it('오류 상태 응답은 상태 코드를 그대로 전달하고 WARNING으로 남긴다', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            status: 429,
            text: async () => 'quota exceeded',
        }) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(geocodeReq, res);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(findLog('WARNING')).toBeDefined();
    });
});
