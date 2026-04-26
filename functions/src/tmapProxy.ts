/**
 * tmapProxy — 프로덕션 환경에서 CORS 없이 티맵 API 호출
 */
import { defineString } from "firebase-functions/params";
import { createAuthenticatedProxy } from "./createAuthenticatedProxy";
import { log } from "./helpers";

const TMAP_API_KEY = defineString("TMAP_API_KEY");

/**
 * T맵 API 응답을 안전하게 JSON으로 파싱한다.
 * - response.ok가 아닌 경우 에러 응답을 로그에 남기고 사용자에게 에러 반환
 * - 빈 body나 비정상 JSON 응답 시 SyntaxError 방지
 */
async function safeFetchJson(
    response: globalThis.Response,
    context: string
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
    const text = await response.text();

    if (!response.ok) {
        log("WARNING", "tmapProxy", `T맵 API 오류 응답 (${context})`, {
            status: response.status,
            body: text.slice(0, 500),
        });
        return { ok: false, status: response.status, error: `T맵 API 오류: ${response.status}` };
    }

    if (!text || text.trim().length === 0) {
        log("WARNING", "tmapProxy", `T맵 API 빈 응답 (${context})`, {
            status: response.status,
        });
        return { ok: false, status: 502, error: "T맵 API에서 빈 응답을 반환했습니다." };
    }

    try {
        const data = JSON.parse(text);
        return { ok: true, data };
    } catch {
        log("ERROR", "tmapProxy", `T맵 API JSON 파싱 실패 (${context})`, {
            status: response.status,
            body: text.slice(0, 500),
        });
        return { ok: false, status: 502, error: "T맵 API 응답을 파싱할 수 없습니다." };
    }
}

/** safeFetchJson 결과를 Express 응답으로 전송 */
function sendResult(
    res: Parameters<Parameters<typeof createAuthenticatedProxy>[1]>[1],
    result: Awaited<ReturnType<typeof safeFetchJson>>
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
        const response = await fetch(url, { headers: { appKey: apiKey } });
        sendResult(res, await safeFetchJson(response, "geocode"));
        return;
    }

    if (action === "poi") {
        const keyword = req.query.keyword as string | undefined;
        if (!keyword || keyword.trim().length < 2) {
            res.status(400).json({ error: "keyword is required and must be at least 2 characters" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword as string)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
        const response = await fetch(url, { headers: { appKey: apiKey } });
        sendResult(res, await safeFetchJson(response, "poi"));
        return;
    }

    if (action === "route") {
        const body = req.body;
        if (!body || !body.startX || !body.endX) {
            res.status(400).json({ error: "startX, startY, endX, endY are required" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/routes?version=1&format=json`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", appKey: apiKey },
            body: JSON.stringify(body),
        });
        sendResult(res, await safeFetchJson(response, "route"));
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
        const response = await fetch(url, { headers: { appKey: apiKey } });
        sendResult(res, await safeFetchJson(response, "geocode-legacy"));
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
        const response = await fetch(url, { headers: { appKey: apiKey } });
        sendResult(res, await safeFetchJson(response, "poi-legacy"));
        return;
    }

    if (path.includes("/routes")) {
        const body = req.body;
        if (!body || !body.startX || !body.endX) {
            res.status(400).json({ error: "startX, startY, endX, endY are required" });
            return;
        }
        const url = `https://apis.openapi.sk.com/tmap/routes?version=1&format=json`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", appKey: apiKey },
            body: JSON.stringify(body),
        });
        sendResult(res, await safeFetchJson(response, "route-legacy"));
        return;
    }

    log("WARNING", "tmapProxy", "지원하지 않는 엔드포인트", { path: req.path });
    res.status(400).json({ error: "지원하지 않는 엔드포인트입니다." });
});
