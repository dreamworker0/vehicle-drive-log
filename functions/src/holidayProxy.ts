/**
 * holidayProxy — 공공데이터 포털 공휴일 API 프록시
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { wrapHttps, log } from "./helpers";
import { checkRateLimitByIp } from "./rateLimit";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

export const holidayProxy = onRequest(
    { region: "asia-northeast3", cors: ["https://vehicle-drive-log.web.app", "https://vehicle-drive-log.firebaseapp.com"] as any },
    wrapHttps("holidayProxy", async (req, res) => {
        // Rate Limiting: IP당 시간당 10회
        const clientIp = req.ip || req.headers["x-forwarded-for"] as string || "unknown";
        const exceeded = await checkRateLimitByIp("holidayProxy", clientIp, 10, 3600);
        if (exceeded) {
            res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
            return;
        }

        const { solYear, numOfRows = 50 } = req.query;

        if (!solYear) {
            res.status(400).json({ error: "solYear is required" });
            return;
        }

        const apiKey = HOLIDAY_API_KEY.value();
        const url =
            `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
            `?serviceKey=${apiKey}&solYear=${solYear}&numOfRows=${numOfRows}&_type=json`;

        const response = await fetch(url);
        const data = await response.json();

        log("INFO", "holidayProxy", `공휴일 조회 완료: ${solYear}년`);
        res.status(200).json(data);
    })
);
