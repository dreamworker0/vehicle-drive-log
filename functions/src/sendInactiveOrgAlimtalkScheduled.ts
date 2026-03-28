import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { sendReminderAlimtalk } from "./sendAlimtalk";

export const sendInactiveOrgAlimtalkScheduled = onSchedule(
    {
        schedule: "0 14 * * 1-5", // 매주 월~금 오후 2시 실행 시도
        timeZone: "Asia/Seoul",
        retryCount: 0,
    },
    async () => {
        const db = getFirestore();
        const nowMs = Date.now();
        const kstOffset = 9 * 60 * 60 * 1000;
        // Date.now()에 9시간 더하면 KST 시각 기준의 Timestamp가 됨
        // 이 상태로 getUTCFullYear 등을 쓰면 "KST 연월일시"를 추출할 수 있음
        const kstDateObj = new Date(nowMs + kstOffset);

        const y = String(kstDateObj.getUTCFullYear());
        const m = String(kstDateObj.getUTCMonth() + 1).padStart(2, "0");
        const d = String(kstDateObj.getUTCDate()).padStart(2, "0");
        const todayStr = `${y}-${m}-${d}`;
        const dayOfWeek = kstDateObj.getUTCDay(); // 0(Sun) ~ 6(Sat)

        // 1. 공휴일 체크
        // system/holidays 문서 구조: { "2026": { "2026-03-01": "삼일절", ... } }
        const holidayDoc = await db.collection("system").doc("holidays").get();
        if (holidayDoc.exists) {
            const holidaysData = holidayDoc.data();
            if (holidaysData && holidaysData[y] && holidaysData[y][todayStr]) {
                const holidayName = holidaysData[y][todayStr];
                console.log(`[Scheduled Alimtalk] 오늘(${todayStr})은 공휴일(${holidayName})이므로 발송을 스킵합니다.`);
                return;
            }
        }

        // 2. 이번 주 발송 이력 우선 확인
        // 이번 주 "월요일" 날짜 구하기
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        // kstDateObj() 기준 이번주의 월요일
        const thisMondayKstTime = kstDateObj.getTime() - diffToMonday * 24 * 60 * 60 * 1000;

        const formatKstToDateStr = (timestamp: number) => {
            const dObj = new Date(timestamp);
            const _y = String(dObj.getUTCFullYear());
            const _m = String(dObj.getUTCMonth() + 1).padStart(2, "0");
            const _d = String(dObj.getUTCDate()).padStart(2, "0");
            return `${_y}-${_m}-${_d}`;
        };
        
        // 이번 주 월요일 문자열(로그 키 값)
        const thisMondayStr = formatKstToDateStr(thisMondayKstTime);

        // 로깅 테이블에서 발송 이력 확인
        const logRef = db.collection("system").doc("alimtalkLogs").collection("inactiveOrg").doc(thisMondayStr);
        const logDoc = await logRef.get();
        if (logDoc.exists && logDoc.data()?.sent) {
            console.log(`[Scheduled Alimtalk] 이번 주(${thisMondayStr} 주간)는 이미 발송이 완료되었습니다.`);
            return;
        }

        // 3. 지난주 월~일 기간 계산 (발송 대상 제한 기준)
        // 지난주 월요일 (이번주 월요일 - 7일)
        const lastWeekMondayKstTime = thisMondayKstTime - 7 * 24 * 60 * 60 * 1000;
        // 지난주 일요일 (이번주 월요일 - 1일)
        const lastWeekSundayKstTime = thisMondayKstTime - 1 * 24 * 60 * 60 * 1000;

        const lastWeekMondayStr = formatKstToDateStr(lastWeekMondayKstTime);
        const lastWeekSundayStr = formatKstToDateStr(lastWeekSundayKstTime);

        // KST 기준 자정 ~ 23:59:59 를 표현하는 Date(UTC 기준 생성) 객체
        const lastMondayStartUtc = new Date(`${lastWeekMondayStr}T00:00:00+09:00`);
        const lastSundayEndUtc = new Date(`${lastWeekSundayStr}T23:59:59.999+09:00`);

        console.log(`[Scheduled Alimtalk] 대상 가입일: ${lastWeekMondayStr} ~ ${lastWeekSundayStr}`);

        // 4. 발송 대상 추출 및 로직 구현
        // 승인된 기관 중 위 기간 내 가입 & 직원이 없는(미활성) 기관
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

            // 직원이 있는지 확인 (1명이라도 있으면 활성화된 것으로 간주)
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

            // 실 발송 및 카운트
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

        // 5. 발송 여부 최종 기록
        await logRef.set({
            sent: true,
            sentAt: new Date(),
            sentCount,
            failCount,
            noPhoneCount,
            results,
            targetWeek: `${lastWeekMondayStr} ~ ${lastWeekSundayStr}`,
            holidaySkipped: dayOfWeek > 1 ? true : false, // 월요일이 아닌 날 발송된 경우
        });
    }
);
