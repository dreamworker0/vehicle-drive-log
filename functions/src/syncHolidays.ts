/**
 * syncHolidays — 매일 오전 6시에 공공데이터 포털 공휴일 정보를 가져와 Firestore에 캐싱
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { recordHeartbeat } from "./helpers";

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

export const syncHolidaysScheduled = onSchedule(
    {
        schedule: "0 6 * * *",
        timeZone: "Asia/Seoul",
        retryCount: 3,
    },
    async () => {
        try {
            const db = getFirestore();
            const apiKey = HOLIDAY_API_KEY.value();
            const currentYear = new Date().getFullYear();
            const yearsToFetch = [currentYear, currentYear + 1];

            const docRef = db.collection("system").doc("holidays");

            const holidaysData: Record<string, Record<string, string>> = {};

            for (const year of yearsToFetch) {
                const url =
                    `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
                    `?serviceKey=${apiKey}&solYear=${year}&numOfRows=100&_type=json`;

                const response = await fetch(url);
                const text = await response.text();

                let data: any;
                try {
                    data = JSON.parse(text);
                } catch (parseError) {
                    console.error(`[공공데이터 API] JSON 파싱 실패 (year: ${year}): ${text.substring(0, 200)}`);
                    continue;
                }

                if (!response.ok) {
                    console.error(`[공공데이터 API] 상태 코드 에러 (year: ${year}): ${response.status}`);
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
                console.log("No holiday data fetched, skipping Firestore update");
            }

            await recordHeartbeat("syncHolidays");
        } catch (error: unknown) {
            console.error("Error syncing holidays:", error);
        }
    }
);
