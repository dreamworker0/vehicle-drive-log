/**
 * holidayProxy — 공공데이터 포털 공휴일 API 프록시
 */
import { defineString } from "firebase-functions/params";
import { createAuthenticatedProxy } from "../../utils/createAuthenticatedProxy";
import { log } from "../../utils/helpers";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

export const holidayProxy = createAuthenticatedProxy("holidayProxy", async (req, res) => {
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
    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        log("ERROR", "holidayProxy", `JSON 파싱 실패 (API 응답): ${text.substring(0, 200)}`);
        res.status(502).json({ error: "공공데이터 포털 API 연동 오류", details: text.substring(0, 100) });
        return;
    }

    if (!response.ok) {
        log("ERROR", "holidayProxy", `공공데이터 포털 에러 응답: ${response.status}`);
        res.status(response.status).json(data);
        return;
    }

    log("INFO", "holidayProxy", `공휴일 조회 완료: ${solYear}년`);
    res.status(200).json(data);
});
