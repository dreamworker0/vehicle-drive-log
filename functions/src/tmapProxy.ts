/**
 * tmapProxy — 프로덕션 환경에서 CORS 없이 티맵 API 호출
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { wrapHttps, log, verifyAuthToken } from "./helpers";
import { checkRateLimitByIp } from "./rateLimit";
import { RATE_LIMITS } from "./constants";

const TMAP_API_KEY = defineString("TMAP_API_KEY");

export const tmapProxy = onRequest(
    { region: "asia-northeast3", cors: ["https://vehicle-drive-log.web.app", "https://vehicle-drive-log.firebaseapp.com"] as any },
    wrapHttps("tmapProxy", async (req, res) => {
        // Firebase Auth 인증 검증
        const uid = await verifyAuthToken(req);
        if (!uid) {
            res.status(401).json({ error: "인증이 필요합니다." });
            return;
        }
        // Rate Limiting: IP당 분당 30회
        const clientIp = req.ip || req.headers["x-forwarded-for"] as string || "unknown";
        const exceeded = await checkRateLimitByIp("tmapProxy", clientIp, RATE_LIMITS.tmapProxy.max, RATE_LIMITS.tmapProxy.windowSec);
        if (exceeded) {
            res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
            return;
        }

        const apiKey = TMAP_API_KEY.value();
        if (!apiKey) {
            res.status(500).json({ error: "TMAP_API_KEY not configured" });
            return;
        }

        const path = req.path || "/";
        const { action } = req.query;

        // ── 패턴 A: ?action= 방식 (신버전 빌드) ──────────────────────────
        if (action === "geocode") {
            const { address } = req.query;
            if (!address) {
                res.status(400).json({ error: "address is required" });
                return;
            }
            const url = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address as string)}`;
            const response = await fetch(url, { headers: { appKey: apiKey } });
            const data = await response.json();
            res.status(200).json(data);
            return;
        }

        if (action === "poi") {
            const { keyword } = req.query;
            if (!keyword) {
                res.status(400).json({ error: "keyword is required" });
                return;
            }
            const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword as string)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
            const response = await fetch(url, { headers: { appKey: apiKey } });
            const data = await response.json();
            res.status(200).json(data);
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
            const data = await response.json();
            res.status(200).json(data);
            return;
        }

        // ── 패턴 B: 경로 방식 (구버전 빌드 호환) ─────────────────────────
        if (path.includes("/geo/fullAddrGeo")) {
            const { fullAddr } = req.query;
            if (!fullAddr) {
                res.status(400).json({ error: "fullAddr is required" });
                return;
            }
            const url = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(fullAddr as string)}`;
            const response = await fetch(url, { headers: { appKey: apiKey } });
            const data = await response.json();
            res.status(200).json(data);
            return;
        }

        if (path.includes("/pois")) {
            const { searchKeyword } = req.query;
            if (!searchKeyword) {
                res.status(400).json({ error: "searchKeyword is required" });
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
            const data = await response.json();
            res.status(200).json(data);
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
            const data = await response.json();
            res.status(200).json(data);
            return;
        }

        log("WARNING", "tmapProxy", "지원하지 않는 엔드포인트", { path: req.path });
        res.status(400).json({ error: "지원하지 않는 엔드포인트입니다." });
    })
);
