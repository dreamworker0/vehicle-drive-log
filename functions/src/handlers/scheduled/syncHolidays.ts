/**
 * syncHolidays — 공공데이터 포털 공휴일 정보를 가져와 Firestore에 캐싱
 *
 * 매월 1일 통합 월배치(monthlyBatch)의 한 단계로 실행된다.
 */
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { recordHeartbeat } from "../../utils/helpers";
import { captureError, captureWarning } from "../../core/sentry";
import { getKSTYear } from "../../utils/kstDate";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

// 공공데이터 포털 공휴일 API 응답(사용 필드만)
interface HolidayApiItem { isHoliday: string; locdate: number; dateName: string; }
interface HolidayApiResponse {
    response?: { body?: { items?: { item?: HolidayApiItem | HolidayApiItem[] } } };
}

export async function syncHolidays(): Promise<void> {
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

                const response = await fetch(url);
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
