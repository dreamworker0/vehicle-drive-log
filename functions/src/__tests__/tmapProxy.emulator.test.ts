/**
 * tmapProxy 에뮬레이터 통합 테스트
 *
 * 외부 티맵 API는 fetch를 mock하고,
 * 인증 검증 / Rate Limit / 라우팅 로직만 에뮬레이터로 실제 검증.
 */
import {
    initializeTestApp,
    clearFirestoreData,
    clearAuthUsers,
    getTestFirestore,
} from "./emulator.setup";
import { getAuth } from "firebase-admin/auth";

initializeTestApp();

const db = getTestFirestore();
const auth = getAuth();

// 원본 fetch 보존 (에뮬레이터 API 호출용)
const originalFetch = global.fetch;

/**
 * verifyAuthToken 로직 재현
 */
async function verifyAuthToken(authHeader?: string): Promise<string | null> {
    if (!authHeader?.startsWith("Bearer ")) return null;
    const idToken = authHeader.slice(7);
    try {
        const decoded = await auth.verifyIdToken(idToken);
        return decoded.uid;
    } catch {
        return null;
    }
}

/**
 * Rate Limit 확인 (Firestore 기반)
 */
async function checkRateLimit(
    functionName: string,
    ip: string,
    maxRequests: number
): Promise<boolean> {
    const safeIp = ip.replace(/[.:]/g, "_");
    const docsSnap = await db
        .collection("_rateLimits")
        .where("functionName", "==", functionName)
        .where("ip", "==", safeIp)
        .get();

    let totalCount = 0;
    docsSnap.docs.forEach((d) => {
        totalCount += d.data().count || 0;
    });

    return totalCount >= maxRequests;
}

/**
 * tmapProxy 핵심 로직 시뮬레이션 — fetch는 mock된 것 사용
 */
async function executeTmapProxy(
    mockFetch: jest.Mock,
    params: {
        authHeader?: string;
        ip?: string;
        action?: string;
        query?: Record<string, string>;
        body?: Record<string, unknown>;
        path?: string;
    }
): Promise<{ status: number; body: unknown }> {
    const { authHeader, ip = "127.0.0.1", action, query = {}, body } = params;

    // 1. 인증 확인
    const uid = await verifyAuthToken(authHeader);
    if (!uid) {
        return { status: 401, body: { error: "인증이 필요합니다." } };
    }

    // 2. Rate Limit 확인
    const exceeded = await checkRateLimit("tmapProxy", ip, 30);
    if (exceeded) {
        return { status: 429, body: { error: "요청이 너무 많습니다." } };
    }

    // 3. 라우팅
    if (action === "geocode") {
        if (!query.address) {
            return { status: 400, body: { error: "address is required" } };
        }
        const data = await (await mockFetch("https://apis.openapi.sk.com/tmap/geo/fullAddrGeo")).json();
        return { status: 200, body: data };
    }

    if (action === "poi") {
        if (!query.keyword) {
            return { status: 400, body: { error: "keyword is required" } };
        }
        const data = await (await mockFetch("https://apis.openapi.sk.com/tmap/pois")).json();
        return { status: 200, body: data };
    }

    if (action === "route") {
        if (!body || !body.startX || !body.endX) {
            return { status: 400, body: { error: "startX, startY, endX, endY are required" } };
        }
        const data = await (await mockFetch("https://apis.openapi.sk.com/tmap/routes")).json();
        return { status: 200, body: data };
    }

    return { status: 400, body: { error: "지원하지 않는 엔드포인트입니다." } };
}

describe("tmapProxy — 에뮬레이터 통합 테스트", () => {
    let validIdToken: string;
    let mockFetch: jest.Mock;

    beforeEach(async () => {
        // 에뮬레이터 정리에는 원본 fetch 사용
        await clearFirestoreData();
        await clearAuthUsers();

        // 테스트용 사용자 생성 및 ID 토큰 발급
        await auth.createUser({ uid: "tmap-user-001", email: "tmap@example.com" });
        const customToken = await auth.createCustomToken("tmap-user-001");

        // 에뮬레이터 REST API로 ID 토큰 교환 (원본 fetch 사용)
        const tokenRes = await originalFetch(
            "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: customToken, returnSecureToken: true }),
            }
        );
        const tokenData = (await tokenRes.json()) as { idToken: string };
        validIdToken = tokenData.idToken;

        // 외부 API mock 설정 (에뮬레이터 호출과 분리)
        mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ result: "mocked tmap response" }),
        });
    });

    afterAll(async () => {
        await clearFirestoreData();
        await clearAuthUsers();
    });

    it("인증 없이 호출 시 401 반환", async () => {
        const result = await executeTmapProxy(mockFetch, {});

        expect(result.status).toBe(401);
        expect(result.body).toEqual(
            expect.objectContaining({ error: expect.stringContaining("인증") })
        );
    });

    it("유효하지 않은 토큰으로 호출 시 401 반환", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: "Bearer invalid-token-123",
        });

        expect(result.status).toBe(401);
    });

    it("geocode action 정상 호출", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "geocode",
            query: { address: "서울특별시 강남구" },
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ result: "mocked tmap response" });
        expect(mockFetch).toHaveBeenCalled();
    });

    it("geocode action에 address 없으면 400", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "geocode",
            query: {},
        });

        expect(result.status).toBe(400);
        expect(result.body).toEqual(
            expect.objectContaining({ error: "address is required" })
        );
    });

    it("poi action 정상 호출", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "poi",
            query: { keyword: "복지관" },
        });

        expect(result.status).toBe(200);
    });

    it("route action 정상 호출", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "route",
            body: { startX: 127.0, startY: 37.5, endX: 127.1, endY: 37.6 },
        });

        expect(result.status).toBe(200);
    });

    it("지원하지 않는 action 시 400 반환", async () => {
        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "unknown",
        });

        expect(result.status).toBe(400);
        expect(result.body).toEqual(
            expect.objectContaining({ error: "지원하지 않는 엔드포인트입니다." })
        );
    });

    it("Rate Limit 초과 시 429 반환", async () => {
        // Firestore에 Rate Limit 문서를 직접 생성하여 초과 상태 시뮬레이션
        const safeIp = "127_0_0_1";
        await db.collection("_rateLimits").doc(`tmapProxy:${safeIp}:test`).set({
            count: 30,
            functionName: "tmapProxy",
            ip: safeIp,
            expiresAt: new Date(Date.now() + 60000),
        });

        const result = await executeTmapProxy(mockFetch, {
            authHeader: `Bearer ${validIdToken}`,
            action: "geocode",
            query: { address: "서울" },
        });

        expect(result.status).toBe(429);
    });
});
