import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { sendReminderAlimtalk } from "../../services/alimtalk/sendAlimtalk";
import { sendDiscordAlert } from "../../core/discord";
import { recordHeartbeat } from "../../utils/helpers";
import { toKSTDate } from "../../utils/kstDate";

/**
 * 디스코드 브리핑: 비활성 기관 알림 + 월요일 주간 리포트
 * (기존 discordScheduler.ts 로직 통합)
 */
async function runDiscordBriefing(db: FirebaseFirestore.Firestore) {
    const kstNow = toKSTDate();
    const dayOfWeek = kstNow.getDay();

    // --- 1. 매일: 가입 후 3일 경과 & 미작성 기관 체크 ---
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    const inactiveSnap = await db.collection("organizations")
        .where("status", "==", "approved")
        .where("createdAt", "<=", threeDaysAgo)
        .where("createdAt", ">", fourDaysAgo)
        .get();

    if (!inactiveSnap.empty) {
        let inactiveListText = "";
        let inactiveCount = 0;

        for (const doc of inactiveSnap.docs) {
            const org = doc.data();
            const membersSnap = await db.collection("users")
                .where("organizationId", "==", doc.id)
                .limit(1)
                .get();

            if (membersSnap.empty) {
                inactiveCount++;
                inactiveListText += `• **${org.name || "이름없음"}** (가입일: ${new Date(org.createdAt?.seconds * 1000).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })})\n`;
            }
        }

        if (inactiveCount > 0) {
            await sendDiscordAlert({
                title: `⚠️ 가입 후 3일 경과 비활성 기관 (${inactiveCount}곳)`,
                description: `다음 기관들은 인증 완료 후 3일이 지났으나 직원을 1명도 등록하지 않았습니다.\n온보딩 지원 스탭의 팔로업이 필요합니다.\n\n${inactiveListText}`,
                color: 16753920,
            }).catch(e => console.error("Discord alert error:", e));
        }
    }

    // --- 2. 주간 브리핑 (월요일에만 실행) ---
    if (dayOfWeek === 1) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const newOrgsAgg = await db.collection("organizations")
            .where("createdAt", ">=", sevenDaysAgo)
            .count()
            .get();
        const newOrgsCount = newOrgsAgg.data().count;

        const newFeedbacksAgg = await db.collection("feedbacks")
            .where("createdAt", ">=", sevenDaysAgo)
            .count()
            .get();
        const newFeedbacksCount = newFeedbacksAgg.data().count;

        await sendDiscordAlert({
            title: "📊 차량운행일지 주간 리포트",
            description: "이번주 한 주를 시작하며, 지난 7일간의 서비스 운영 지표를 공유합니다.",
            color: 10181046,
            fields: [
                { name: "✨ 신규 가입 기관", value: `${newOrgsCount} 곳`, inline: true },
                { name: "💬 접수된 고객 의견", value: `${newFeedbacksCount} 건`, inline: true }
            ]
        }).catch(e => console.error("Discord alert error:", e));
    }

    await recordHeartbeat("discordBriefing");
}

export const sendInactiveOrgAlimtalkScheduled = onSchedule(
    {
        schedule: "0 14 * * 1-5", // 매주 월~금 오후 2시 실행
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async () => {
        const db = getFirestore();
        const nowMs = Date.now();
        const kstOffset = 9 * 60 * 60 * 1000;
        const kstDateObj = new Date(nowMs + kstOffset);

        const y = String(kstDateObj.getUTCFullYear());
        const m = String(kstDateObj.getUTCMonth() + 1).padStart(2, "0");
        const d = String(kstDateObj.getUTCDate()).padStart(2, "0");
        const todayStr = `${y}-${m}-${d}`;
        const dayOfWeek = kstDateObj.getUTCDay();

        // === Part 1: 디스코드 브리핑 (기존 discordScheduler 통합) ===
        try {
            await runDiscordBriefing(db);
        } catch (e: unknown) {
            console.error("Error in discordBriefing:", (e as Error).message);
        }

        // === Part 2: 미활성 기관 알림톡 발송 ===

        // 1. 공휴일 체크
        const holidayDoc = await db.collection("system").doc("holidays").get();
        if (holidayDoc.exists) {
            const holidaysData = holidayDoc.data();
            if (holidaysData && holidaysData[y] && holidaysData[y][todayStr]) {
                const holidayName = holidaysData[y][todayStr];
                console.log(`[Scheduled Alimtalk] 오늘(${todayStr})은 공휴일(${holidayName})이므로 발송을 스킵합니다.`);
                return;
            }
        }

        // 2. 이번 주 발송 이력 확인
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const thisMondayKstTime = kstDateObj.getTime() - diffToMonday * 24 * 60 * 60 * 1000;

        const formatKstToDateStr = (timestamp: number) => {
            const dObj = new Date(timestamp);
            const _y = String(dObj.getUTCFullYear());
            const _m = String(dObj.getUTCMonth() + 1).padStart(2, "0");
            const _d = String(dObj.getUTCDate()).padStart(2, "0");
            return `${_y}-${_m}-${_d}`;
        };
        
        const thisMondayStr = formatKstToDateStr(thisMondayKstTime);

        const logRef = db.collection("system").doc("alimtalkLogs").collection("inactiveOrg").doc(thisMondayStr);
        const logDoc = await logRef.get();
        if (logDoc.exists && logDoc.data()?.sent) {
            console.log(`[Scheduled Alimtalk] 이번 주(${thisMondayStr} 주간)는 이미 발송이 완료되었습니다.`);
            return;
        }

        // 3. 지난주 월~일 기간 계산
        const lastWeekMondayKstTime = thisMondayKstTime - 7 * 24 * 60 * 60 * 1000;
        const lastWeekSundayKstTime = thisMondayKstTime - 1 * 24 * 60 * 60 * 1000;

        const lastWeekMondayStr = formatKstToDateStr(lastWeekMondayKstTime);
        const lastWeekSundayStr = formatKstToDateStr(lastWeekSundayKstTime);

        const lastMondayStartUtc = new Date(`${lastWeekMondayStr}T00:00:00+09:00`);
        const lastSundayEndUtc = new Date(`${lastWeekSundayStr}T23:59:59.999+09:00`);

        console.log(`[Scheduled Alimtalk] 대상 가입일: ${lastWeekMondayStr} ~ ${lastWeekSundayStr}`);

        // 4. 발송 대상 추출 및 발송
        const orgsSnap = await db.collection("organizations")
            .where("status", "==", "approved")
            .where("createdAt", ">=", lastMondayStartUtc)
            .where("createdAt", "<=", lastSundayEndUtc)
            .get();

        const results: { orgName: string; phone: string; success: boolean; message?: string }[] = [];
        let sentCount = 0;
        let failCount = 0;
        let noPhoneCount = 0;

        for (const orgDoc of orgsSnap.docs) {
            const org = orgDoc.data();

            const membersSnap = await db.collection("users")
                .where("organizationId", "==", orgDoc.id)
                .limit(1)
                .get();

            if (!membersSnap.empty) continue; 

            const phone = org.applicantPhone || org.phone;
            if (!phone) {
                noPhoneCount++;
                results.push({ orgName: org.name, phone: "-", success: false, message: "전화번호 없음" });
                continue;
            }

            const name = org.applicantName || org.name;
            const inviteCode = org.inviteCode || "";

            if (!inviteCode) {
                failCount++;
                results.push({ orgName: org.name, phone, success: false, message: "초대코드 없음" });
                continue;
            }

            try {
                const result = await sendReminderAlimtalk(phone, name, org.name, inviteCode);
                if (result.success) {
                    sentCount++;
                } else {
                    failCount++;
                }
                results.push({ orgName: org.name, phone, success: result.success, message: result.message });
            } catch (err: unknown) {
                failCount++;
                results.push({ orgName: org.name, phone, success: false, message: (err as Error).message });
            }
        }

        console.log(`[Scheduled Alimtalk] 발송 완료: 성공 ${sentCount}, 실패 ${failCount}, 번호없음 ${noPhoneCount}`);

        await logRef.set({
            sent: true,
            sentAt: new Date(),
            sentCount,
            failCount,
            noPhoneCount,
            results,
            targetWeek: `${lastWeekMondayStr} ~ ${lastWeekSundayStr}`,
            holidaySkipped: dayOfWeek > 1 ? true : false,
        });

        // 5. 디스코드 알림 발송
        await sendDiscordAlert({
            title: "📢 미활성 기관 알림톡 발송 완료",
            description: `미신청 기관에 대한 리마인드 알림톡 발송이 완료되었습니다.\n대상 가입일: ${lastWeekMondayStr} ~ ${lastWeekSundayStr}`,
            color: 3066993,
            fields: [
                { name: "발송 성공", value: `${sentCount}건`, inline: true },
                { name: "발송 실패", value: `${failCount}건`, inline: true },
                { name: "전화번호 없음", value: `${noPhoneCount}건`, inline: true }
            ]
        });
    }
);

