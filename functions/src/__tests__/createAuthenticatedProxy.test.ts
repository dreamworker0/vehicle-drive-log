/**
 * createAuthenticatedProxy.test.ts — 인증 프록시 팩토리 특성화 테스트
 *
 * `holidayProxy`·`tmapProxy`가 이 팩토리를 감싸 쓰므로, 여기가 두 외부 API 경로의
 * 공통 관문이다(인증 → uid 기반 rate limit → 핸들러). 커버리지가 0%였다.
 *
 * 이 테스트를 먼저 붙인 이유는 **런타임 메이저 이관의 전제**였기 때문이다(Phase 216에서 이관 완료).
 * 당시 예상은 "@types/express 5에서 `Request`/`Response` named export가 사라진다"였는데
 * **그건 사실이 아니었다** — 5에도 `interface Response`가 그대로 있다. 실제로 났던 오류는
 * 트리에 express 타입이 **두 벌** 공존해(우리 4 vs functions 7이 번들한 5) `sendfile` 유무로
 * 갈린 TS2345였고, 한 벌로 맞추니 이 파일은 한 줄도 고치지 않았다.
 * 그래도 이 테스트를 붙인 판단 자체는 옳았다 — 관문 로직이 무검증이면 무검증 이관이 된다.
 *
 * 고정하는 계약:
 *   1. Authorization 헤더가 없거나 유효하지 않으면 401, 핸들러 미실행
 *   2. rate limit 초과 시 429, 핸들러 미실행
 *   3. 통과 시 핸들러에 uid가 전달된다
 *   4. rate limit 키는 IP가 아니라 `uid_{uid}` — 헤더로 버킷을 회전시킬 수 없다
 *      (2026-08-14 감사 발견 2의 회귀 방지)
 */

// onRequest는 옵션·핸들러를 그대로 통과시켜 내부 핸들러를 직접 호출할 수 있게 한다.
const mockOnRequest = jest.fn((_opts: unknown, handler: unknown) => handler);
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (...args: unknown[]) => mockOnRequest(args[0], args[1]),
}));

const mockVerifyAuthToken = jest.fn();
jest.mock('../utils/helpers', () => ({
    // wrapHttps는 에러 래핑만 하므로 통과시킨다 (에러 경로는 helpers 자체 테스트가 덮는다)
    wrapHttps: (_name: string, handler: unknown) => handler,
    verifyAuthToken: (...args: unknown[]) => mockVerifyAuthToken(...args),
}));

const mockCheckRateLimit = jest.fn();
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitBySubject: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

jest.mock('../utils/constants', () => ({
    getRateLimits: async () => ({ max: 30, windowSec: 60 }),
}));

import { createAuthenticatedProxy } from '../utils/createAuthenticatedProxy';

type Res = {
    status: jest.Mock;
    json: jest.Mock;
};

function makeRes(): Res {
    const res: Res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

// 팩토리가 돌려주는 것은 (mock 덕분에) 내부 핸들러 그 자체다.
type Handler = (req: unknown, res: unknown) => Promise<void>;

describe('createAuthenticatedProxy', () => {
    let business: jest.Mock;
    let proxy: Handler;

    beforeEach(() => {
        jest.clearAllMocks();
        business = jest.fn(async () => {});
        proxy = createAuthenticatedProxy('tmapProxy', business) as unknown as Handler;
    });

    it('인증 실패 시 401을 돌려주고 비즈니스 로직을 실행하지 않는다', async () => {
        mockVerifyAuthToken.mockResolvedValue(null);
        const res = makeRes();

        await proxy({ headers: {} }, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: '인증이 필요합니다.' });
        expect(business).not.toHaveBeenCalled();
        // 인증 전에는 rate limit 카운터도 올리지 않는다 (미인증 요청이 남의 버킷을 소모하지 않게)
        expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('rate limit 초과 시 429를 돌려주고 비즈니스 로직을 실행하지 않는다', async () => {
        mockVerifyAuthToken.mockResolvedValue('uid-1');
        mockCheckRateLimit.mockResolvedValue(true);
        const res = makeRes();

        await proxy({ headers: {} }, res);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(business).not.toHaveBeenCalled();
    });

    it('통과하면 비즈니스 로직에 uid를 넘긴다', async () => {
        mockVerifyAuthToken.mockResolvedValue('uid-1');
        mockCheckRateLimit.mockResolvedValue(false);
        const req = { headers: {}, query: { lat: '37.5' } };
        const res = makeRes();

        await proxy(req, res);

        expect(business).toHaveBeenCalledTimes(1);
        expect(business).toHaveBeenCalledWith(req, res, 'uid-1');
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rate limit 키는 uid다 — 헤더로 버킷을 회전시킬 수 없다', async () => {
        mockVerifyAuthToken.mockResolvedValue('uid-1');
        mockCheckRateLimit.mockResolvedValue(false);

        // X-Forwarded-For를 바꿔 넣어도 키가 달라지지 않아야 한다
        await proxy({ headers: { 'x-forwarded-for': '1.1.1.1' } }, makeRes());
        await proxy({ headers: { 'x-forwarded-for': '2.2.2.2' } }, makeRes());

        expect(mockCheckRateLimit).toHaveBeenCalledTimes(2);
        for (const call of mockCheckRateLimit.mock.calls) {
            expect(call[0]).toBe('tmapProxy');   // 함수 이름 = rate limit 키
            expect(call[1]).toBe('uid_uid-1');   // 주체 = uid (IP 아님)
        }
    });

    it('함수 이름을 rate limit 키로 그대로 쓴다 (프록시별 한도 분리)', async () => {
        mockVerifyAuthToken.mockResolvedValue('uid-2');
        mockCheckRateLimit.mockResolvedValue(false);

        const holiday = createAuthenticatedProxy('holidayProxy', business) as unknown as Handler;
        await holiday({ headers: {} }, makeRes());

        expect(mockCheckRateLimit).toHaveBeenCalledWith('holidayProxy', 'uid_uid-2', 30, 60);
    });

    it('CORS를 앱 도메인으로 제한하고 서울 리전에 배치한다', () => {
        const opts = mockOnRequest.mock.calls[0][0] as { region: string; cors: string[] };
        expect(opts.region).toBe('asia-northeast3');
        expect(opts.cors).toEqual([
            'https://vehicle-drive-log.web.app',
            'https://vehicle-drive-log.firebaseapp.com',
        ]);
    });
});
