/**
 * holidayProxy — 공공데이터 포털 공휴일 API 프록시
 */
import { defineString } from "firebase-functions/params";
import { createAuthenticatedProxy } from "../../utils/createAuthenticatedProxy";
import { log } from "../../utils/helpers";
import { describeFetchFailure } from "../../utils/fetchFailure";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

/**
 * 공공데이터 포털 응답 대기 상한(ms).
 *
 * 원래 이 fetch에는 상한이 없어, 상대가 응답하지 않으면 함수 인스턴스가 기본 타임아웃
 * (60초)까지 묶였다. 화면(src/lib/holidayApi.ts)은 5초에 포기하고 공휴일 없이 진행하므로
 * 그 뒤는 아무도 기다리지 않는 시간이다. 다만 이 API는 평소에도 느려서(apiHealthCheck의
 * pingHoliday 주석) 5초에 맞춰 끊으면 정상 응답까지 잘라내므로 여유를 둔다.
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * 화면이 이 프록시를 부른 사유(`fallbackReason`)를 로그에 적을 수 있게 다듬는다.
 *
 * 화면(src/lib/holidayApi.ts)은 Firestore `system/holidays`를 먼저 읽고 실패했을 때만 여기로
 * 온다. 그 사유가 여태 클라이언트 콘솔에만 남아 **폴백이 왜 도는지 알 수 없었다**
 * (Phase 200 남는 것 ②). 클라이언트가 보내는 값이므로 그대로 로그에 넣지 않는다 —
 * 길이와 문자를 묶어 로그를 어지럽히거나 줄을 끼워 넣지 못하게 한다.
 */
function sanitizeReason(raw: unknown): string {
    if (typeof raw !== "string" || raw.length === 0) return "none";
    const cleaned = raw.slice(0, 64).replace(/[^A-Za-z0-9._+-]/g, "");
    return cleaned || "invalid";
}

export const holidayProxy = createAuthenticatedProxy("holidayProxy", async (req, res) => {
    const { solYear, numOfRows = 50 } = req.query;
    // 화면이 폴백을 타게 된 사유 — 모든 로그 줄에 함께 남긴다
    const clientReason = sanitizeReason(req.query.fallbackReason);

    if (!solYear) {
        res.status(400).json({ error: "solYear is required" });
        return;
    }

    const apiKey = HOLIDAY_API_KEY.value();
    const url =
        `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
        `?serviceKey=${apiKey}&solYear=${solYear}&numOfRows=${numOfRows}&_type=json`;

    // 공공데이터 포털에 닿지 못하는 것은 우리 쪽 결함이 아니다. 예전에는 이 fetch가 그대로
    // 거부되어 wrapHttps가 ERROR로 올렸고, 상대 쪽 네트워크가 한 번 흔들린 것만으로
    // Sentry·Discord 경보가 울렸다(2026-09-03 "fetch failed"). 화면은 공휴일 없이도 동작하므로
    // 경보 대상이 아니다 — WARNING으로 남겨 Cloud Logging에서는 추적하되 502로 돌려준다.
    // (헬스체크가 이 API의 타임아웃을 degraded로 낮춘 것과 같은 기준이다.)
    let status: number;
    let text: string;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        status = response.status;
        text = await response.text();
    } catch (err) {
        log("WARNING", "holidayProxy", "공공데이터 포털 연결 실패", {
            solYear,
            reason: describeFetchFailure(err),
            clientReason,
        });
        res.status(502).json({ error: "공공데이터 포털에 연결할 수 없습니다." });
        return;
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        // 상대가 JSON 대신 XML·HTML 에러 문서를 돌려준 경우. 월배치(syncHolidays)도 같은 상황을
        // captureWarning으로 남긴다 — 여기만 ERROR로 올리면 같은 사건이 경보 두 종류로 갈린다.
        log("WARNING", "holidayProxy", `JSON 파싱 실패 (API 응답): ${text.substring(0, 200)}`, { clientReason });
        res.status(502).json({ error: "공공데이터 포털 API 연동 오류", details: text.substring(0, 100) });
        return;
    }

    if (status < 200 || status >= 300) {
        log("WARNING", "holidayProxy", `공공데이터 포털 에러 응답: ${status}`, { clientReason });
        res.status(status).json(data);
        return;
    }

    log("INFO", "holidayProxy", `공휴일 조회 완료: ${solYear}년`, { clientReason });
    res.status(200).json(data);
});
