import { getFirestore } from "firebase-admin/firestore";
import { sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";
import { resolveOrgSlackBotToken, sendSlackDMToUser } from "../../services/slack/notifySlackUser";
import { toKSTDate, getKSTDateString } from "../../utils/kstDate";

const db = getFirestore();

/**
 * 예약 시작 10분 전 알림 + 운행일지 미작성 알림 전송
 * Cloud Functions Scheduler에서 15분마다 호출 (비용 최적화 적용됨)
 */
export async function checkReservationReminders(): Promise<void> {
    const now = new Date();
    const kstNow = toKSTDate(now);

    const todayStr = getKSTDateString(now);
    const currentHH = String(kstNow.getHours()).padStart(2, "0");
    const currentMM = String(kstNow.getMinutes()).padStart(2, "0");
    const currentTime = `${currentHH}:${currentMM}`;

    // 10분 후 시각 계산
    const tenMinLater = new Date(kstNow.getTime() + 10 * 60 * 1000);
    const laterHH = String(tenMinLater.getHours()).padStart(2, "0");
    const laterMM = String(tenMinLater.getMinutes()).padStart(2, "0");
    const tenMinLaterTime = `${laterHH}:${laterMM}`;

    console.log(`[Reminder] Check at ${todayStr} ${currentTime} (KST), 10min later = ${tenMinLaterTime}`);

    try {
        // === 1. 예약 시작 10분 전 알림 ===
        const reservationsSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "==", "reserved")
            .where("startTime", ">=", currentTime)
            .where("startTime", "<=", tenMinLaterTime)
            .get();

        // 기관별 Slack 봇 토큰 캐시 — 같은 run에서 동일 기관 연동 조회를 1회로 줄인다.
        // 값이 undefined면 미조회, null이면 미연동/조회 실패(재조회 안 함).
        const slackTokenByOrg = new Map<string, string | null>();

        let reminderCount = 0;
        for (const doc of reservationsSnap.docs) {
            const res = doc.data();
            if (res.reminderSent) continue;

            const targetUid = res.reservedByUid || res.userId;
            if (targetUid) {
                const title = "🚗 예약 임박";
                const body = `${res.vehicleDisplayName || "차량"} 예약이 ${res.startTime}에 시작됩니다.`;

                await sendPushToUser(targetUid, { title, body });
                await createInAppNotification(targetUid, "reservation_reminder", title, body, res.organizationId);

                // Slack DM(부가 채널) — 실패는 조용히 삼켜 FCM/인앱을 막지 않는다.
                const orgId = res.organizationId as string | undefined;
                if (orgId) {
                    let botToken = slackTokenByOrg.get(orgId);
                    if (botToken === undefined) {
                        botToken = await resolveOrgSlackBotToken(orgId);
                        slackTokenByOrg.set(orgId, botToken);
                    }
                    if (botToken) {
                        await sendSlackDMToUser(botToken, targetUid, `🚗 ${body}`);
                    }
                }

                await db.collection("reservations").doc(doc.id).update({
                    reminderSent: true,
                });

                reminderCount++;
            }
        }

        // === 2. 운행일지 미작성 알림 ===
        const completedSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "in", ["completed", "in_progress"])
            .get();

        let missedCount = 0;

        // 알림 대상 후보를 먼저 고른다 — 운행일지 존재 확인은 아래에서 한 번에 묶어서 한다.
        const missedCandidates = completedSnap.docs.filter((doc) => {
            const res = doc.data();
            if (res.endTime && res.endTime > currentTime) return false;
            if (res.driveLogReminderSent) return false;
            return Boolean(res.reservedByUid || res.userId);
        });

        // 운행일지 존재 여부를 **후보 전체에 대해 한 번에** 조회한다.
        //
        // 예전에는 후보마다 `where(reservationId,==,id).limit(1)`을 따로 던졌다. Firestore는
        // **결과가 없는 쿼리에도 읽기 1건을 최소 과금**하므로, 일지를 아직 안 쓴 후보(= 알림을
        // 보내야 하는 바로 그 후보)가 많을수록 후보 수만큼 읽기가 그대로 청구됐다.
        // 묶으면 청크당 1회 왕복 + 실제로 존재하는 일지 수만큼만 읽는다.
        // 이 스케줄러는 평일 08~18시 매시(하루 11회) 돌아 예약 건수에 비례해 누적된다.
        const loggedReservationIds = new Set<string>();
        const IN_CHUNK = 30; // Firestore `in` 절의 값 상한
        for (let i = 0; i < missedCandidates.length; i += IN_CHUNK) {
            const ids = missedCandidates.slice(i, i + IN_CHUNK).map((doc) => doc.id);
            const logsSnap = await db.collection("driveLogs")
                .where("reservationId", "in", ids)
                .get();
            for (const logDoc of logsSnap.docs) {
                const reservationId = logDoc.data().reservationId;
                if (typeof reservationId === "string") loggedReservationIds.add(reservationId);
            }
        }

        for (const doc of missedCandidates) {
            if (loggedReservationIds.has(doc.id)) continue; // 이미 작성됨

            const res = doc.data();
            const targetUid = (res.reservedByUid || res.userId) as string;
            const title = "📝 운행일지 작성 알림";
            const body = `${res.vehicleDisplayName || "차량"} 운행이 종료되었습니다. 운행일지를 작성해주세요.`;

            await sendPushToUser(targetUid, { title, body });
            await createInAppNotification(targetUid, "drive_log_reminder", title, body, res.organizationId);

            await db.collection("reservations").doc(doc.id).update({
                driveLogReminderSent: true,
            });

            missedCount++;
        }

        // === 3. 미출발(No-show) 알림 ===
        const fifteenMinAgo = new Date(kstNow.getTime() - 15 * 60 * 1000);
        const agoHH = String(fifteenMinAgo.getHours()).padStart(2, "0");
        const agoMM = String(fifteenMinAgo.getMinutes()).padStart(2, "0");
        const fifteenMinAgoTime = `${agoHH}:${agoMM}`;

        const noShowSnap = await db.collection("reservations")
            .where("date", "==", todayStr)
            .where("status", "==", "reserved")
            .where("startTime", "<=", fifteenMinAgoTime)
            .get();

        let noShowCount = 0;
        for (const doc of noShowSnap.docs) {
            const res = doc.data();
            if (res.noShowReminderSent) continue;

            const targetUid = res.reservedByUid || res.userId;
            if (targetUid) {
                const cancelUrl = `https://vehicle-drive-log.web.app?cancelReservation=${doc.id}`;
                const title = "🚨 예약 시작시간이 지났습니다";
                const body = `${res.vehicleDisplayName || "차량"} 예약(${res.startTime})이 시작되었으나 운행이 시작되지 않았습니다. 탭하여 예약을 취소하거나 유지하세요.`;

                await sendPushToUser(targetUid, { title, body }, {
                    link: cancelUrl,
                    reservationId: doc.id,
                    action: "cancel_prompt",
                });
                await createInAppNotification(targetUid, "no_show_reminder", title, body, res.organizationId);

                await db.collection("reservations").doc(doc.id).update({
                    noShowReminderSent: true,
                });

                noShowCount++;
            }
        }

        console.log(`[Reminder] Sent ${reminderCount} upcoming, ${missedCount} drive log, ${noShowCount} no-show reminders`);
    } catch (err: unknown) {
        console.error("[Reminder] Failed:", (err as Error).message);
    }
}
