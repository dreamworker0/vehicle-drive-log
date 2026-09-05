import { getFirestore } from "firebase-admin/firestore";
import { sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";
import { resolveOrgSlackBotToken, sendSlackDMToUser } from "../../services/slack/notifySlackUser";
import { toKSTDate, getKSTDateString } from "../../utils/kstDate";

const db = getFirestore();

/** Firestore `in` 절의 값 상한 — §2(운행일지 조회)와 §3(다일 형제 조회)이 함께 쓴다 */
const IN_CHUNK = 30;

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
        // 다일 예약의 둘째 날 이후(startTime "00:00")는 여기 걸리지 않는다 — 하한이
        // `startTime >= currentTime`이고 이 스케줄러의 첫 실행이 08:00(KST)이라 항상 "00:00"보다 늦다.
        // (§3의 미출발 알림은 하한이 없어 걸렸다.) 이건 코드가 아니라 **cron에 기댄 전제**라
        // 스케줄을 새벽까지 넓히면 그날 깨진다 — schedulerCpuOptions.test.ts가 cron을 고정한다.
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

        // 알림 대상 후보를 먼저 고른다 — 다일 그룹 확인은 아래에서 한 번에 묶어서 한다.
        const noShowCandidates = noShowSnap.docs.filter((doc) => {
            const res = doc.data();
            if (res.noShowReminderSent) return false;
            return Boolean(res.reservedByUid || res.userId);
        });

        // 다일(연속) 예약의 **둘째 날 이후**는 이 쿼리에 무조건 걸린다.
        //
        // 다일 예약은 하루당 문서 하나로 쪼개져 저장되고(첫날 = 실제 출발시각~23:59,
        // 중간 날 = 00:00~23:59, 마지막 날 = 00:00~반납시각), 같은 groupId를 공유한다.
        // 그래서 둘째 날 문서는 `startTime: "00:00"` · `status: "reserved"`인데, 운전자는
        // 이미 첫날 차를 가지고 나가 있고 운행일지는 돌아와서야 쓴다. 아침 첫 실행(08:00)에
        // 이 문서가 그대로 걸려 **운행 중인 사람에게 "아직 출발하지 않으셨나요?"가 간다.**
        // (#323이 붙인 driveLogReminderSent로는 못 막는다 — 그 표시는 일지를 쓴 뒤에야 붙고,
        //  이 알림은 일지를 쓰기 전인 아침에 나가기 때문이다.)
        //
        // 같은 groupId의 **앞선 날짜** 문서가 in_progress/completed면 이미 출발한 것으로 보고
        // 건너뛴다. 그룹 조회는 후보마다 따로 던지지 않는다 — Firestore는 결과가 없는 쿼리에도
        // 읽기 1건을 최소 과금하므로(§2와 같은 이유), groupId를 모아 `in` 절로 묶어
        // 청크당 1회만 왕복한다. 이 스케줄러는 평일 08~18시 매시(하루 11회) 돈다.
        //
        // completed도 근거로 본다. 이걸 빼면 **마지막 날 아침에 일지를 쓴 경우** 그 날
        // 문서에 헛알림이 되살아난다(일지는 출발한 날 문서를 가리키므로 첫날만 completed가 된다).
        //
        // 조기 반납으로 남은 날이 방치될 걱정은 여기서 하지 않는다 — 일지를 저장하면
        // 타지 않은 날은 cancelled로 정리되고(completeReservationGroupSiblings) 차량도 함께
        // 풀린다. cancelled는 이 쿼리의 `status == "reserved"`에 애초에 걸리지 않는다.
        //
        // 억제된 후보에는 noShowReminderSent를 붙이지 않으므로(진짜 미출발로 바뀌면 다시
        // 알려야 한다) 이 그룹 조회는 여행 기간 내내 매 실행마다 다시 나간다 — 그룹당
        // 문서 몇 건 규모라 감당 가능한 값으로 봤다.
        const groupIds = [...new Set(
            noShowCandidates
                .map((doc) => doc.data().groupId)
                .filter((id): id is string => typeof id === "string" && id !== "")
        )];

        // 그룹별 기관 — 형제 문서를 기관 경계 너머로 잘못 집계하지 않도록 대조용으로 쓴다.
        const orgByGroupId = new Map<string, unknown>();
        for (const doc of noShowCandidates) {
            const res = doc.data();
            if (typeof res.groupId === "string" && res.groupId) {
                orgByGroupId.set(res.groupId, res.organizationId);
            }
        }

        const startedGroupIds = new Set<string>();
        for (let i = 0; i < groupIds.length; i += IN_CHUNK) {
            const chunk = groupIds.slice(i, i + IN_CHUNK);
            const siblingsSnap = await db.collection("reservations")
                .where("groupId", "in", chunk)
                .get();

            for (const sibling of siblingsSnap.docs) {
                const sib = sibling.data();
                const gid = sib.groupId;
                if (typeof gid !== "string") continue;
                if (sib.organizationId !== orgByGroupId.get(gid)) continue; // 타 기관 문서는 무시
                if (sib.status !== "in_progress" && sib.status !== "completed") continue;
                // 앞선 날짜만 본다 — 오늘·이후 날짜는 "이미 출발했다"의 근거가 되지 못한다.
                if (typeof sib.date !== "string" || sib.date >= todayStr) continue;
                startedGroupIds.add(gid);
            }
        }

        for (const doc of noShowCandidates) {
            const res = doc.data();
            if (typeof res.groupId === "string" && startedGroupIds.has(res.groupId)) continue; // 운행 중인 다일 예약

            const targetUid = (res.reservedByUid || res.userId) as string;
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

        console.log(`[Reminder] Sent ${reminderCount} upcoming, ${missedCount} drive log, ${noShowCount} no-show reminders`);
    } catch (err: unknown) {
        console.error("[Reminder] Failed:", (err as Error).message);
    }
}
