import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { syncVehicleCalendar } from "./calendarSchedule";

const db = getFirestore();

/**
 * 구글 캘린더 Watch (Webhook) 수신 엔드포인트
 * - 구글 클라우드 콘솔의 도메인 인증이 완료된 도메인에만 사용 가능 (Firebase Hosting 도메인 등)
 */
export const handleCalendarWebhook = onRequest(async (req, res) => {
    const channelId = req.headers["x-goog-channel-id"] as string;
    const resourceState = req.headers["x-goog-resource-state"] as string;

    // 인증이나 채널 생성 확인 과정
    if (!channelId) {
        res.status(400).send("Missing Channel ID");
        return;
    }

    // 채널 생성 시 최초로 전달되는 상태
    if (resourceState === "sync") {
        console.log(`[Calendar Webhook] Sync signal received for channel: ${channelId}`);
        res.status(200).send("OK");
        return;
    }

    try {
        // 1. 해당 Webhook Channel ID로 등록된 차량(Vehicle) 찾기
        const vehiclesSnap = await db.collection("vehicles")
            .where("calendarChannelId", "==", channelId)
            .limit(1)
            .get();

        if (vehiclesSnap.empty) {
            console.warn(`[Calendar Webhook] Unmapped channel ID received: ${channelId}`);
            res.status(200).send("OK"); // 구글에는 200 반환 (에러 반환 시 재시도 폭탄 우려)
            return;
        }

        const vehicleDoc = vehiclesSnap.docs[0];
        const vehicleInfo = vehicleDoc.data();
        const vehicleName = vehicleInfo.displayName || vehicleDoc.id;

        console.log(`[Calendar Webhook] Modification detected for vehicle: ${vehicleName} (Channel: ${channelId})`);

        // 특정 차량에 대해서만 즉시 캘린더 동기화를 수행 (웹훅 트리거)
        await syncVehicleCalendar(vehicleDoc.id, vehicleInfo);

        // 현재는 Webhook 수신 시각을 차량 문서에 업데이트 하는 정도로 반응만 체크
        await vehicleDoc.ref.update({
            lastWebhookReceivedAt: new Date()
        });

    } catch(err) {
        console.error("[Calendar Webhook] Processing error:", err);
    }

    // 리소스 처리 여부와 무관하게 200 응답 강제 (Google API 규약)
    res.status(200).send("OK");
});
