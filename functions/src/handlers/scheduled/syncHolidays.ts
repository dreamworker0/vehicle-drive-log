/**
 * syncHolidays — 공공데이터 포털 공휴일 정보를 가져와 Firestore에 캐싱
 *
 * 매월 1일 통합 월배치(monthlyBatch)의 한 단계로 실행된다.
 *
 * ## 재시도하는 이유 (2026-11-01 장애)
 *
 * 11월 배치에서 `apis.data.go.kr` 연결이 10초 만에 끊겼다(undici `UND_ERR_CONNECT_TIMEOUT`).
 * 예전에는 fetch가 던지면 연도별 처리 바깥의 catch로 빠져 **두 해 모두 건너뛰고 하트비트도
 * 남기지 못했다.** 이 배치는 월 1회라 일시적인 연결 실패 한 번이 헬스 체크의 '공휴일 동기화'
 * 카드를 다음 달 1일까지 한 달 내내 빨갛게 만든다.
 *
 * 그래서 연도마다 몇 번 재시도하고, 그래도 닿지 못한 해는 상태 코드 오류와 똑같이 그 해만
 * 건너뛴다(경고). 두 해 모두 못 받은 경우의 처리(기존 문서 유지 + captureError + 하트비트)는
 * 상태 코드 오류 때와 같다.
 */
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { recordHeartbeat } from "../../utils/helpers";
import { captureError, captureWarning } from "../../core/sentry";
import { getKSTYear } from "../../utils/kstDate";
import { describeFetchFailure } from "../../utils/fetchFailure";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

/**
 * 재시도 전 대기(ms). 길이 = 재시도 횟수 → 연도당 최대 3번 시도한다.
 * 최악(매번 30초 타임아웃)이어도 연도당 3×30 + 15 + 45 = 150초, 두 해 300초라
 * monthlyBatch 타임아웃(540초) 안에 다음 단계(마일리지 검증)까지 끝난다.
 */
const RETRY_DELAYS_MS = [15_000, 45_000];

/** 시도 1회의 상한 — 걸린 연결이 배치를 붙잡지 않게 한다. */
const ATTEMPT_TIMEOUT_MS = 30_000;

// 공공데이터 포털 공휴일 API 응답(사용 필드만)
interface HolidayApiItem { isHoliday: string; locdate: number; dateName: string; }
interface HolidayApiResponse {
    response?: { body?: { items?: { item?: HolidayApiItem | HolidayApiItem[] } } };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 다시 물으면 나아질 수 있는 응답인가 — 서버 오류·과부하만. 4xx(키 오류 등)는 몇 번 물어도 같다. */
function isRetryableStatus(status: number): boolean {
    return status >= 500 || status === 429;
}

/**
 * 한 해치 요청 — 연결 실패·5xx·429면 재시도한다.
 * 마지막 시도에서도 연결하지 못하면 그 오류를 던진다(호출 측이 그 해만 건너뛴다).
 * 마지막 시도의 5xx 응답은 그대로 돌려준다(호출 측의 상태 코드 경고 경로).
 */
async function fetchYear(url: string, retryDelaysMs: number[]): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        const canRetry = attempt < retryDelaysMs.length;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
            if (response.ok || !canRetry || !isRetryableStatus(response.status)) return response;
            console.warn(`[공공데이터 API] ${response.status} 응답 — 재시도 ${attempt + 1}/${retryDelaysMs.length}`);
        } catch (err: unknown) {
            if (!canRetry) throw err;
            console.warn(
                `[공공데이터 API] 연결 실패(${describeFetchFailure(err)}) — 재시도 ${attempt + 1}/${retryDelaysMs.length}`,
            );
        }
        await sleep(retryDelaysMs[attempt]);
    }
}

/**
 * @param options.retryDelaysMs 재시도 전 대기(테스트에서 0으로 줄인다)
 */
export async function syncHolidays(options: { retryDelaysMs?: number[] } = {}): Promise<void> {
    const retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    try {
            const db = getFirestore();
            const apiKey = HOLIDAY_API_KEY.value();
            const currentYear = getKSTYear();
            const yearsToFetch = [currentYear, currentYear + 1];

            const docRef = db.collection("system").doc("holidays");

            const holidaysData: Record<string, Record<string, string>> = {};

            for (const year of yearsToFetch) {
                const url =
                    `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
                    `?serviceKey=${apiKey}&solYear=${year}&numOfRows=100&_type=json`;

                let response: Response;
                try {
                    response = await fetchYear(url, retryDelaysMs);
                } catch (err: unknown) {
                    // 재시도까지 닿지 못했다 — 상태 코드 오류와 같이 이 해만 건너뛴다.
                    // 예전처럼 바깥 catch로 던지면 나머지 해와 하트비트까지 함께 사라진다.
                    const cause = describeFetchFailure(err);
                    console.error(`[공공데이터 API] 연결 실패 (year: ${year}): ${cause}`);
                    captureWarning("공휴일 API에 연결하지 못했다(재시도 포함) — 해당 연도를 건너뛴다", {
                        year,
                        cause,
                        attempts: retryDelaysMs.length + 1,
                    });
                    continue;
                }
                const text = await response.text();

                let data: HolidayApiResponse;
                try {
                    data = JSON.parse(text);
                } catch {
                    console.error(`[공공데이터 API] JSON 파싱 실패 (year: ${year}): ${text.substring(0, 200)}`);
                    captureWarning("공휴일 API 응답을 파싱하지 못했다 — 해당 연도를 건너뛴다", {
                        year,
                        bodyPreview: text.substring(0, 200),
                    });
                    continue;
                }

                if (!response.ok) {
                    console.error(`[공공데이터 API] 상태 코드 에러 (year: ${year}): ${response.status}`);
                    captureWarning("공휴일 API가 오류 상태로 응답했다 — 해당 연도를 건너뛴다", {
                        year,
                        status: response.status,
                    });
                    continue;
                }

                const items = data?.response?.body?.items?.item;

                const map: Record<string, string> = {};
                if (items) {
                    const list = Array.isArray(items) ? items : [items];
                    list.forEach((item: { isHoliday: string; locdate: number; dateName: string }) => {
                        if (item.isHoliday === "Y") {
                            const locdate = String(item.locdate);
                            const dateStr = `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`;
                            map[dateStr] = item.dateName;
                        }
                    });
                }

                holidaysData[year] = map;
                console.log(`Fetched and parsed ${Object.keys(map).length} holidays for year ${year}`);
            }

            if (Object.keys(holidaysData).length > 0) {
                await docRef.set(holidaysData, { merge: true });
                console.log("Successfully synced holidays to Firestore");
            } else {
                // 한 해도 받지 못한 경우. 기존 문서를 지우지 않는 것은 의도한 동작이지만,
                // 그대로 두면 **하트비트는 정상으로 찍히고 공휴일만 낡은 채 남는다** —
                // 화면의 공휴일 표시가 조용히 틀어지는 형태라 반드시 보고한다.
                console.log("No holiday data fetched, skipping Firestore update");
                captureError(
                    new Error("공휴일 동기화가 한 해도 받지 못했다 — Firestore 갱신 생략(기존 데이터 유지)"),
                    { fn: "syncHolidays", yearsToFetch }
                );
            }

            await recordHeartbeat("syncHolidays");
        } catch (error: unknown) {
            console.error("Error syncing holidays:", error);
            captureError(error, { fn: "syncHolidays" });
        }
}
