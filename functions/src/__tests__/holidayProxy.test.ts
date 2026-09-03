/**
 * holidayProxy.test.ts — 공공데이터 포털 프록시의 실패 처리
 *
 * 2026-09-03, 상대 쪽 네트워크가 잠깐 흔들려 `fetch`가 거부된 것만으로 Sentry에
 * "fetch failed"가 올라왔다(원인 없이 message 한 줄뿐이라 조치할 것도 없었다).
 * 화면(src/lib/holidayApi.ts)은 Firestore를 먼저 읽고 이 프록시는 폴백일 뿐이라
 * 공휴일이 비어도 동작한다 — 즉 **경보를 울릴 사건이 아니다.**
 *
 * 고정하는 계약:
 *   1. 외부 API에 닿지 못하면 502 + WARNING (ERROR로 올리지 않는다 = 경보 없음)
 *   2. 실패 로그에 원인(undici cause code / timeout)이 남는다
 *   3. 응답 없는 상대에 묶이지 않도록 fetch에 타임아웃 시그널을 건다
 *   4. 정상 응답은 그대로 통과시킨다
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
    // wrapHttps는 에러 래핑만 하므로 통과시킨다 (에러 경로는 helpers 자체 테스트가 덮는다)
    wrapHttps: (_name: string, handler: unknown) => handler,
    verifyAuthToken: async () => 'uid_test',
    log: (...args: unknown[]) => mockLog(...args),
}));

jest.mock('../utils/rateLimit', () => ({
    checkRateLimitBySubject: async () => false,
}));

jest.mock('../utils/constants', () => ({
    getRateLimits: async () => ({ max: 10, windowSec: 3600 }),
}));

import { holidayProxy } from '../handlers/https/holidayProxy';

type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
    const res: Res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

// onRequest·wrapHttps를 통과시켰으므로 export된 값은 핸들러 그 자체다.
const proxy = holidayProxy as unknown as (req: unknown, res: unknown) => Promise<void>;

const req = { headers: { authorization: 'Bearer token' }, query: { solYear: '2026' } };

/** 로그 호출 중 severity가 일치하는 첫 항목 */
function findLog(severity: string) {
    return mockLog.mock.calls.find(c => c[0] === severity);
}

describe('holidayProxy — 외부 API 실패 처리', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('연결 실패는 502로 돌려주고 ERROR가 아닌 WARNING으로 남긴다', async () => {
        // undici가 만드는 모양 — message는 "fetch failed" 한 줄, 실제 원인은 cause에 있다
        const err = new TypeError('fetch failed');
        (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNRESET' };
        global.fetch = jest.fn().mockRejectedValue(err) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(req, res);

        expect(res.status).toHaveBeenCalledWith(502);
        // 경보가 울리면 안 된다 — log("ERROR")가 곧 captureError다
        expect(findLog('ERROR')).toBeUndefined();
        const warning = findLog('WARNING');
        expect(warning).toBeDefined();
        expect(warning?.[3]).toMatchObject({ solYear: '2026', reason: 'ECONNRESET' });
    });

    it('타임아웃은 원인을 timeout으로 적는다', async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        global.fetch = jest.fn().mockRejectedValue(err) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(req, res);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(findLog('WARNING')?.[3]).toMatchObject({ reason: 'timeout' });
    });

    it('응답 없는 상대에 묶이지 않도록 타임아웃 시그널을 건다', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => JSON.stringify({ response: { body: { items: {} } } }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        await proxy(req, makeRes());

        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('정상 응답은 그대로 통과시킨다', async () => {
        const payload = { response: { body: { items: { item: [] } } } };
        global.fetch = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => JSON.stringify(payload),
        }) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(payload);
        expect(findLog('INFO')).toBeDefined();
    });

    it('상대가 JSON 대신 오류 문서를 돌려주면 502 + WARNING', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            status: 200,
            text: async () => '<OpenAPI_ServiceResponse><errMsg>SERVICE ERROR</errMsg>',
        }) as unknown as typeof fetch;
        const res = makeRes();

        await proxy(req, res);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(findLog('ERROR')).toBeUndefined();
        expect(findLog('WARNING')).toBeDefined();
    });
});
