import * as admin from "firebase-admin";
import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";

// 구글 사이트 소유권 확인이 완료된 도메인 주소여야 합니다. (Functions 고정 URL 등)
// 예: https://your-custom-domain.com/handleCalendarWebhook 
const WEBHOOK_RECEIVING_URL = process.env.WEBHOOK_RECEIVING_URL || "https://your-verified-domain.com/handleCalendarWebhook";

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

async function getCalendarClient() {
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
}

/**
 * 등록된 모든 차량의 캘린더 ID를 읽어와 구글 캘린더 Webhook(Watch) 구독을 지시합니다.
 */
async function registerWatch() {
    const calendar = await getCalendarClient();
    const vehiclesSnap = await db.collection("vehicles").where("googleCalendarId", "!=", "").get();

    for (const doc of vehiclesSnap.docs) {
        const vehicle = doc.data();
        const calendarId = vehicle.googleCalendarId;
        const channelId = uuidv4(); // 채널 식별을 위한 고유 UUID

        console.log(`[Watch] Attempting for ${vehicle.displayName} (Cal: ${calendarId})`);

        try {
            const resp = await calendar.events.watch({
                calendarId,
                requestBody: {
                    id: channelId, // 커스텀 채널 ID
                    type: "web_hook",
                    address: WEBHOOK_RECEIVING_URL, // 수신받을 엔드포인트
                }
            });

            console.log(`✅ Success for ${vehicle.displayName}. Channel ID: ${channelId}`);
            
            // 수신시 차량을 매핑하기 위해 Firestore에 정보 저장
            await doc.ref.update({
                calendarChannelId: channelId,
                calendarResourceId: resp.data.resourceId,
                calendarWatchExpiration: resp.data.expiration
            });

        } catch (err: unknown) {
            console.error(`❌ Failed to register watch for ${vehicle.displayName}:`, (err as Error).message);
            console.error("-> [힌트] 도메인 소유권 인증이 안 되어 있을 확률이 높습니다.");
        }
    }
}

registerWatch().then(() => {
    console.log("=== Calendar Watch Registration Complete ===");
    process.exit(0);
}).catch((err) => {
    console.error("General Error:", err);
    process.exit(1);
});
