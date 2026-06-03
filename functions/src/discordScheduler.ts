import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { sendDiscordAlert } from "./discord";
import { recordHeartbeat } from "./helpers";
import { toKSTDate } from "./utils/kstDate";

export const scheduledDiscordBriefing = onSchedule(
    {
        schedule: "0 9 * * *", // 매일 오전 9시 (KST 설정은 아래 로직에서 UTC-KST offset으로 커버하거나 파라미터로 지정)
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async (event) => {
        const db = getFirestore();
        const now = new Date();
        const kstNow = toKSTDate(now);
        const dayOfWeek = kstNow.getDay(); // 0: Sunday, 1: Monday...

        // --- 1. 매일: 가입 후 3일 경과 & 미작성 기관 체크 ---
        const threeDaysAgo = toKSTDate();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const fourDaysAgo = toKSTDate();
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
                // 직원이 있는지 확인 (1명이라도 있으면 패스)
                const membersSnap = await db.collection("users")
                    .where("organizationId", "==", doc.id)
                    .limit(1)
                    .get();

                if (membersSnap.empty) {
                    inactiveCount++;
                    inactiveListText += `• **${org.name || "이름없음"}** (가입일: ${new Date(org.createdAt?.seconds * 1000).toLocaleDateString()})\n`;
                }
            }

            if (inactiveCount > 0) {
                await sendDiscordAlert({
                    title: `⚠️ 가입 후 3일 경과 비활성 기관 (${inactiveCount}곳)`,
                    description: `다음 기관들은 인증 완료 후 3일이 지났으나 직원을 1명도 등록하지 않았습니다.\n온보딩 지원 스탭의 팔로업이 필요합니다.\n\n${inactiveListText}`,
                    color: 16753920, // 주황색
                }).catch(e => console.error("Discord alert error:", e));
            }
        }

        // --- 2. 주간 브리핑 (월요일 오전 9시에만 실행) ---
        if (dayOfWeek === 1) { // 1 = 월요일
            const sevenDaysAgo = toKSTDate();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            // 주간 신규 가입 기관수
            const newOrgsAgg = await db.collection("organizations")
                .where("createdAt", ">=", sevenDaysAgo)
                .count()
                .get();
            const newOrgsCount = newOrgsAgg.data().count;
            
            // 주간 고객 의견 수
            const newFeedbacksAgg = await db.collection("feedbacks")
                .where("createdAt", ">=", sevenDaysAgo)
                .count()
                .get();
            const newFeedbacksCount = newFeedbacksAgg.data().count;

            await sendDiscordAlert({
                title: `📊 차량운행일지 주간 리포트`,
                description: `이번주 한 주를 시작하며, 지난 7일간의 서비스 운영 지표를 공유합니다.`,
                color: 10181046, // 보라색 / Indigo
                fields: [
                    { name: "✨ 신규 가입 기관", value: `${newOrgsCount} 곳`, inline: true },
                    { name: "💬 접수된 고객 의견", value: `${newFeedbacksCount} 건`, inline: true }
                ]
            }).catch(e => console.error("Discord alert error:", e));
        }

        await recordHeartbeat("discordBriefing");
    }
);
