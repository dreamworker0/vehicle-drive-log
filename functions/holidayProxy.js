const { onRequest } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const { wrapHttps, log } = require("./helpers");

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

/**
 * 공공데이터 포털 공휴일 API 프록시
 * 프로덕션 환경에서 CORS 문제 없이 공휴일 데이터를 가져옴
 */
exports.holidayProxy = onRequest(
    { region: "asia-northeast3", cors: ["https://vehicle-drive-log.web.app", "https://vehicle-drive-log.firebaseapp.com"] },
    wrapHttps("holidayProxy", async (req, res) => {
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
