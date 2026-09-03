/**
 * tmapProxy — 프로덕션 환경에서 CORS 없이 티맵 API 호출
 */
import { defineString } from "firebase-functions/params";
import { createAuthenticatedProxy } from "../../utils/createAuthenticatedProxy";
import { log } from "../../utils/helpers";
import { describeFetchFailure } from "../../utils/fetchFailure";

const TMAP_API_KEY = defineString("TMAP_API_KEY");

/**
 * T맵 API 응답 대기 상한(ms).
 *
 * 원래 이 fetch들에는 상한이 없어, 상대가 응답하지 않으면 함수 인스턴스가 기본 타임아웃
 * (60초)까지 묶였다. 이 프록시는 사용자가 주소를 찾거나 경로를 계산하는 동안 기다리는
 * 경로라 그렇게 오래 붙잡아 둘 값이 없다 — holidayProxy와 같은 값으로 끊는다.
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** fetchTmapJson 결과 — 성공이면 파싱된 JSON, 실패면 그대로 내보낼 상태 코드와 문구 */
type TmapResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };

/**
 * T맵 API를 호출해 응답을 안전하게 JSON으로 파싱한다.
 *
 * - **닿지 못한 경우**(DNS·연결 끊김·타임아웃): 502 + WARNING. 상대 쪽 네트워크가 흔들린 것은
 *   우리 결함이 아니라 경보 대상이 아니다. 예전에는 이 fetch가 그대로 거부되어 `wrapHttps`가
 *   ERROR로 올렸고, 같은 구조 때문에 holidayProxy가 2026-09-03에 실제로 경보를 울렸다.
 *   원인은 undici가 `cause`에 숨기므로 `describeFetchFailure`로 꺼내 남긴다.
 * - 2xx가 아닌 응답 / 빈 body / JSON 파싱 실패: 종전과 같다.
 */
async function fetchTmapJson(url: string, init: RequestInit, context: string): Promise<TmapResult> {
    let status: number;
    let text: string;
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        status = response.status;
        text = await response.text();
    } catch (err) {
        log("WARNING", "tmapProxy", `T맵 API 연결 실패 (${context})`, {
            reason: describeFetchFailure(err),
        });
        return { ok: false, status: 502, error: "T맵 API에 연결할 수 없습니다." };
    }

    if (status < 200 || status >= 300) {
        log("WARNING", "tmapProxy", `T맵 API 오류 응답 (${context})`, {
            status,
            body: text.slice(0, 500),
        });
        return { ok: false, status, error: `T맵 API 오류: ${status}` };
    }

    if (!text || text.trim().length === 0) {
        log("WARNING", "tmapProxy", `T맵 API 빈 응답 (${context})`, { status });
        return { ok: false, status: 502, error: "T맵 API에서 빈 응답을 반환했습니다." };
    }

    try {
        const data = JSON.parse(text);
        return { ok: true, data };
    } catch {
        // 2xx인데 JSON이 아니라면 상대의 장애가 아니라 엔드포인트·계약 문제일 수 있다 —
        // 실제로 한 번도 발생하지 않았고 조치가 필요한 종류라 ERROR로 둔다.
        log("ERROR", "tmapProxy", `T맵 API JSON 파싱 실패 (${context})`, {
            status,
            body: text.slice(0, 500),
        });
        return { ok: false, status: 502, error: "T맵 API 응답을 파싱할 수 없습니다." };
    }
}

/** fetchTmapJson 결과를 Express 응답으로 전송 */
function sendResult(
    res: Parameters<Parameters<typeof createAuthenticatedProxy>[1]>[1],
    result: TmapResult
) {
    if (result.ok) {
        res.status(200).json(result.data);
    } else {
        res.status(result.status).json({ error: result.error });
    }
}

export const tmapProxy = createAuthenticatedProxy("tmapProxy", async (req, res) => {
    const apiKey = TMAP_API_KEY.value();
    if (!apiKey) {
        res.status(500).json({ error: "TMAP_API_KEY not configured" });
        return;
    }

    const path = req.path || "/";
    const { action } = req.query;

    // ── 패턴 A: ?action= 방식 (신버전 빌드) ──────────────────────────
    if (action === "geocode") {
        const address = req.query.address as string | undefined;
        if (!address || address.trim().length < 2) {
            res.status(400).json({ error: "address is required and must be at least 2 characters" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address as string)}`;
        sendResult(res, await fetchTmapJson(url, { headers: { appKey: apiKey } }, "geocode"));
        return;
    }

    if (action === "poi") {
        const keyword = req.query.keyword as string | undefined;
        if (!keyword || keyword.trim().length < 2) {
            res.status(400).json({ error: "keyword is required and must be at least 2 characters" });
            return;
        }
        const countRaw = parseInt((req.query.count as string) || "1", 10);
        const count = Math.min(Math.max(isNaN(countRaw) ? 1 : countRaw, 1), 10);
        const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword as string)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=${count}`;
        sendResult(res, await fetchTmapJson(url, { headers: { appKey: apiKey } }, "poi"));
        return;
    }

    if (action === "route") {
        const body = req.body;
        if (!body || !body.startX || !body.endX) {
            res.status(400).json({ error: "startX, startY, endX, endY are required" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/routes?version=1&format=json`;
        const result = await fetchTmapJson(
            url,
            {
                method: "POST",
                headers: { "Content-Type": "application/json", appKey: apiKey },
                body: JSON.stringify(body),
            },
            "route",
        );
        // 클라이언트는 features[0].properties(총 거리/시간/요금)만 사용하므로
        // 전체 경로 좌표(features 배열)를 제거하여 페이로드를 대폭 경량화한다.
        if (result.ok) {
            const data = result.data as { features?: { properties?: unknown }[] };
            const props = data?.features?.[0]?.properties;
            res.status(200).json({ features: [{ properties: props || {} }] });
        } else {
            res.status(result.status).json({ error: result.error });
        }
        return;
    }

    // ── 패턴 B: 경로 방식 (구버전 빌드 호환) ─────────────────────────
    if (path.includes("/geo/fullAddrGeo")) {
        const fullAddr = req.query.fullAddr as string | undefined;
        if (!fullAddr || fullAddr.trim().length < 2) {
            res.status(400).json({ error: "fullAddr is required and must be at least 2 characters" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(fullAddr as string)}`;
        sendResult(res, await fetchTmapJson(url, { headers: { appKey: apiKey } }, "geocode-legacy"));
        return;
    }

    if (path.includes("/pois")) {
        const searchKeyword = req.query.searchKeyword as string | undefined;
        if (!searchKeyword || searchKeyword.trim().length < 2) {
            res.status(400).json({ error: "searchKeyword is required and must be at least 2 characters" });
            return;
        }
        const params = new URLSearchParams({
            version: "1",
            format: "json",
            searchKeyword: searchKeyword as string,
            resCoordType: (req.query.resCoordType as string) || "WGS84GEO",
            reqCoordType: (req.query.reqCoordType as string) || "WGS84GEO",
            count: (req.query.count as string) || "1",
        });
        const url = `https://apis.openapi.sk.com/tmap/pois?${params.toString()}`;
        sendResult(res, await fetchTmapJson(url, { headers: { appKey: apiKey } }, "poi-legacy"));
        return;
    }

    if (path.includes("/routes")) {
        const body = req.body;
        if (!body || !body.startX || !body.endX) {
            res.status(400).json({ error: "startX, startY, endX, endY are required" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/routes?version=1&format=json`;
        const result = await fetchTmapJson(
            url,
            {
                method: "POST",
                headers: { "Content-Type": "application/json", appKey: apiKey },
                body: JSON.stringify(body),
            },
            "route-legacy",
        );
        if (result.ok) {
            const data = result.data as { features?: { properties?: unknown }[] };
            const props = data?.features?.[0]?.properties;
            res.status(200).json({ features: [{ properties: props || {} }] });
        } else {
            res.status(result.status).json({ error: result.error });
        }
        return;
    }

    log("WARNING", "tmapProxy", "지원하지 않는 엔드포인트", { path: req.path });
    res.status(400).json({ error: "지원하지 않는 엔드포인트입니다." });
});
