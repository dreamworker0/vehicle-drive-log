const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { getFirestore } = require("firebase-admin/firestore");

const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");

/**
 * 매일 오전 6시에 실행되어 공공데이터 포털의 휴일 정보를 가져와 Firestore에 저장합니다.
 * 올해와 내년 데이터를 캐싱합니다.
 */
exports.syncHolidaysScheduled = onSchedule(
    {
        schedule: "0 6 * * *",
        timeZone: "Asia/Seoul",
        retryCount: 3,
    },
    async (event) => {
        try {
            const db = getFirestore();
            const apiKey = HOLIDAY_API_KEY.value();
            const currentYear = new Date().getFullYear();
            const yearsToFetch = [currentYear, currentYear + 1];

            const docRef = db.collection("system").doc("holidays");

            const holidaysData = {};

            for (const year of yearsToFetch) {
                const url =
                    `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
                    `?serviceKey=${apiKey}&solYear=${year}&numOfRows=100&_type=json`;

                const response = await fetch(url);
                if (!response.ok) {
                    console.error(`Failed to fetch holidays for year ${year}: ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const items = data?.response?.body?.items?.item;

                const map = {};
                if (items) {
                    const list = Array.isArray(items) ? items : [items];
                    list.forEach((item) => {
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

            // Object.keys(holidaysData).length > 0 일 때만 문서 업데이트
            if (Object.keys(holidaysData).length > 0) {
                await docRef.set(holidaysData, { merge: true });
                console.log("Successfully synced holidays to Firestore");
            } else {
                console.log("No holiday data fetched, skipping Firestore update");
            }

        } catch (error) {
            console.error("Error syncing holidays:", error);
        }
    }
);
