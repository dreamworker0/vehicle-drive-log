/**
 * tmapProxy 에뮬레이터 통합 테스트 — **실물 핸들러**를 구동한다
 *
 * 예전 이 파일은 `verifyAuthToken`·rate limit·라우팅을 테스트 안에서 **다시 구현한 사본**을
 * 검사했다. 그래서 Phase 201에서 프록시의 fetch 처리를 전부 바꿨는데도 초록이었고, rate limit
 * 키가 IP에서 uid로 바뀐 뒤에도(2026-08-14 감사 발견 2) 사본은 여전히 IP로 세고 있었다 —
 * **구현이 갈라져도 통과하는 테스트**였다. 이제 `tmapProxy`를 그대로 import해 실행한다.
 *
 * 목으로 갈아치우는 것은 셋뿐이다:
 *   - `onRequest` — 옵션·핸들러를 통과시켜 핸들러를 직접 부를 수 있게 한다
 *   - `defineString` — 배포 파라미터(TMAP_API_KEY)
 *   - `getRateLimits` — **한도 값만** 낮춘다(1시간 2회). 세는 장치(Firestore 트랜잭션)는 실물이다.
 *     윈도우를 넉넉히 두는 이유는 플레이크 방지다 — 60초 윈도우는 경계가 호출 사이에 걸리면
 *     카운터가 리셋되어 429가 나지 않는다. 문서는 테스트마다 clearFirestoreData로 지운다
 *
 * 인증(Auth 에뮬레이터의 실제 ID 토큰 검증) · rate limit 누적(Firestore 에뮬레이터) ·
 * 라우팅 · 응답 처리는 모두 실물 코드다. 외부 티맵 API만 URL로 갈라 가로챈다.
 */
import {
    initializeTestApp,
    clearFirestoreData,
    clearAuthUsers,
    getTestFirestore,
} from "./emulator.setup";
import { getAuth } from "firebase-admin/auth";

initializeTestApp();

// 기본 5초로는 부족하다 — 각 테스트의 첫 rate limit 트랜잭션이 Firestore 에뮬레이터로 가는
// gRPC 채널을 새로 여느라 몇 초를 먹는다(테스트 로직이 느린 것이 아니다).
jest.setTimeout(30_000);

/** getRateLimits 목이 돌려주는 한도와 같은 값 (목 팩토리 안에서는 변수를 참조할 수 없어 중복해 둔다) */
const RATE_LIMIT_MAX = 2;

const mockOnRequest = jest.fn((_opts: unknown, handler: unknown) => handler);
jest.mock("firebase-functions/v2/https", () => ({
    onRequest: (...args: unknown[]) => mockOnRequest(args[0], args[1]),
}));

jest.mock("firebase-functions/params", () => ({
    defineString: () => ({ value: () => "TEST_APP_KEY" }),
}));

jest.mock("../utils/constants", () => ({
    getRateLimits: async () => ({ max: 2, windowSec: 3600 }),
}));

import { tmapProxy } from "../handlers/https/tmapProxy";

const db = getTestFirestore();
const auth = getAuth();

// === 외부 티맵 호출만 가로챈다 ===
// 에뮬레이터 정리·토큰 교환도 global.fetch를 쓰므로 통째로 갈아치우면 안 된다. URL로 가른다.
const originalFetch = global.fetch;
type TmapReply = { status: number; text: () => Promise<string> };
type TmapInit = { headers?: Record<string, string>; method?: string; body?: string; signal?: AbortSignal };

let tmapResponder: (url: string, init?: unknown) => Promise<TmapReply>;
const tmapCalls: { url: string; init?: TmapInit }[] = [];

global.fetch = ((input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes("apis.openapi.sk.com")) {
        tmapCalls.push({ url, init: init as TmapInit });
        return tmapResponder(url, init);
    }
    return (originalFetch as unknown as (i: unknown, n?: unknown) => Promise<unknown>)(input, init);
}) as unknown as typeof fetch;

type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
    const res: Res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

// onRequest·defineString만 목이므로 export된 값은 실물 핸들러다.
const proxy = tmapProxy as unknown as (req: unknown, res: unknown) => Promise<void>;

/** 정상 지오코딩 응답 */
function okGeocode(): Promise<TmapReply> {
    return Promise.resolve({
        status: 200,
        text: async () => JSON.stringify({ coordinateInfo: { coordinate: [{ lat: "37.5", lon: "127.0" }] } }),
    });
}

describe("tmapProxy — 에뮬레이터 통합 테스트 (실물 핸들러)", () => {
    const UID = "tmap-user-001";
    let validIdToken: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        tmapCalls.length = 0;
        tmapResponder = okGeocode;

        await clearFirestoreData();
        await clearAuthUsers();

        await auth.createUser({ uid: UID, email: "tmap@example.com" });
        const customToken = await auth.createCustomToken(UID);

        // 에뮬레이터 REST API로 ID 토큰 교환 (티맵이 아닌 URL이라 원본 fetch로 나간다)
        const tokenRes = await fetch(
            "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: customToken, returnSecureToken: true }),
            }
        );
        const tokenData = (await tokenRes.json()) as { idToken: string };
        validIdToken = tokenData.idToken;
    });

    afterAll(async () => {
        await clearFirestoreData();
        await clearAuthUsers();
        global.fetch = originalFetch;
    });

    /** 인증된 지오코딩 요청 */
    function geocodeReq(address = "서울특별시 강남구") {
        return {
            headers: { authorization: `Bearer ${validIdToken}` },
            path: "/",
            query: { action: "geocode", address },
        };
    }

    it("인증 헤더가 없으면 401 — 외부 API를 부르지 않는다", async () => {
        const res = makeRes();

        await proxy({ headers: {}, path: "/", query: { action: "geocode", address: "서울" } }, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(tmapCalls).toHaveLength(0);
    });

    it("위조된 토큰은 실제 검증에서 걸러 401", async () => {
        const res = makeRes();

        await proxy(
            {
                headers: { authorization: "Bearer invalid-token-123" },
                path: "/",
                query: { action: "geocode", address: "서울" },
            },
            res
        );

        expect(res.status).toHaveBeenCalledWith(401);
        expect(tmapCalls).toHaveLength(0);
    });

    it("유효한 ID 토큰이면 통과하고 티맵 호출에 appKey·주소·타임아웃이 실린다", async () => {
        const res = makeRes();

        await proxy(geocodeReq(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(tmapCalls).toHaveLength(1);
        expect(tmapCalls[0].url).toContain("fullAddrGeo");
        expect(tmapCalls[0].url).toContain(encodeURIComponent("서울특별시 강남구"));
        expect(tmapCalls[0].init?.headers).toMatchObject({ appKey: "TEST_APP_KEY" });
        // Phase 201 — 응답 없는 상대에 인스턴스가 묶이지 않게 하는 시그널
        expect(tmapCalls[0].init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("필수 파라미터가 빠지면 400 — 외부 API를 부르지 않는다", async () => {
        const res = makeRes();

        await proxy(
            { headers: { authorization: `Bearer ${validIdToken}` }, path: "/", query: { action: "geocode" } },
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(tmapCalls).toHaveLength(0);
    });

    it("지원하지 않는 요청은 400", async () => {
        const res = makeRes();

        await proxy(
            { headers: { authorization: `Bearer ${validIdToken}` }, path: "/", query: { action: "unknown" } },
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(tmapCalls).toHaveLength(0);
    });

    it("티맵에 닿지 못하면 502 — 상대 장애가 우리 예외가 되지 않는다", async () => {
        const err = new TypeError("fetch failed");
        (err as unknown as { cause: { code: string } }).cause = { code: "ECONNRESET" };
        tmapResponder = () => Promise.reject(err);
        const res = makeRes();

        await proxy(geocodeReq(), res);

        expect(res.status).toHaveBeenCalledWith(502);
    });

    it("한도를 넘기면 429이고, 카운터는 IP가 아니라 uid로 쌓인다", async () => {
        // 한도까지는 통과
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            const res = makeRes();
            await proxy(geocodeReq(), res);
            expect(res.status).toHaveBeenCalledWith(200);
        }

        // 초과분은 거부되고 외부 API도 부르지 않는다
        const callsBefore = tmapCalls.length;
        const res = makeRes();
        await proxy(geocodeReq(), res);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(tmapCalls).toHaveLength(callsBefore);

        // 문서 ID가 uid 기반인지 — IP 기반으로 되돌아가면 헤더 한 줄로 버킷을 회전시킬 수 있다
        const snap = await db.collection("_rateLimits").where("functionName", "==", "tmapProxy").get();
        expect(snap.empty).toBe(false);
        expect(snap.docs.some(d => d.id.includes(`uid_${UID}`))).toBe(true);
        expect(snap.docs.reduce((sum, d) => sum + (d.data().count || 0), 0)).toBe(RATE_LIMIT_MAX);
    });

    it("헤더로 IP를 바꿔도 같은 uid면 같은 버킷을 쓴다", async () => {
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            await proxy(
                {
                    ...geocodeReq(),
                    headers: { authorization: `Bearer ${validIdToken}`, "x-forwarded-for": `10.0.0.${i}` },
                },
                makeRes()
            );
        }

        const res = makeRes();
        await proxy(
            {
                ...geocodeReq(),
                headers: { authorization: `Bearer ${validIdToken}`, "x-forwarded-for": "10.9.9.9" },
            },
            res
        );

        expect(res.status).toHaveBeenCalledWith(429);
    });
});
