/**
 * reservationReminderScheduler — 예약 알림 스케줄러 (D13 규칙 준수: index.ts에서 분리)
 *
 * 평일 08~18시, 매시 정각에 실행하여 예약 임박 알림 및 미작성 운행일지 알림을 발송한다.
 * 비용 최적화: 15분→1시간 주기로 변경, 주말/야간 제외 (App Engine cron → 표준 cron 전환)
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { checkReservationReminders } from "../../services/alimtalk/reservationReminder";
import { warmupOcrFunction } from "../../services/ocr/warmupOcr";
import { recordHeartbeat } from "../../utils/helpers";
import { SLACK_TOKEN_ENC_KEY } from "../../core/params";

export const reservationReminder = onSchedule(
    {
        schedule: "0 8-18 * * 1-5",
        timeZone: "Asia/Seoul",
        retryCount: 0,
        // 리마인더는 Slack DM 채널도 태운다(checkReservationReminders → resolveOrgSlackBotToken →
        // getSlackIntegration → decryptSlackToken). 시크릿을 선언하지 않으면 .value()가 빈 문자열이라
        // 복호화가 "암호화 키가 비어 있습니다."로 죽고, Slack DM만 매시간 조용히 누락된다.
        // (tokenCrypto 상단 규칙: 이 래퍼를 쓰는 함수는 secrets에 선언해야 한다)
        secrets: [SLACK_TOKEN_ENC_KEY],
        // CPU 분수 할당 — firebase-functions v2는 메모리와 무관하게 모든 함수에 1 vCPU를 붙인다
        // (options.d.ts: "Defaults to 1 for functions with <= 2GB RAM"). Cloud Run 요금은 vCPU-초가
        // GiB-초보다 약 10배 비싸므로 여기가 실질 지렛대다. gcf_gen1은 gen1의 분수 CPU로 되돌린다.
        // 이 함수는 외부 API·Firestore 응답을 기다리는 시간이 대부분이라 CPU를 줄여도 소요가 그만큼
        // 늘지 않는다. concurrency는 cpu<1이면 1이어야 하는데, 스케줄 함수는 한 번에 한 번만 도니
        // 손해가 없다. **전역 concurrency(80)를 그대로 두면 배포가 거부되므로 반드시 명시한다.**
        // (2026-08-29 Cloud Run 비용 점검 — 야간 배치 3종은 타임아웃 여유가 없어 제외했다)
        cpu: "gcf_gen1",
        concurrency: 1,
        // CPU를 1/3로 줄이는 만큼 상한에 여유를 둔다. Cloud Run은 실제 실행 시간만 과금하므로
        // 여유 자체에는 비용이 없고, 늘어난 소요가 상한에 닿아 통째로 실패하는 쪽이 훨씬 나쁘다.
        timeoutSeconds: 300,
    },
    async function () {
        // 주말(토/일)에는 스킵 (비용 절감)
        const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const dayOfWeek = nowKST.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            await recordHeartbeat("reservationReminder");
            return;
        }
        await checkReservationReminders();

        // OCR 콜드스타트 완화 — 같은 근무시간 cron에 편승해 ocrDashboard를 워밍업한다.
        // (근무시간 가드·10초 타임아웃은 warmupOcrFunction 내부에 있음. 실패해도 알림 발송에 영향 없음)
        try {
            await warmupOcrFunction();
        } catch (err) {
            console.warn("[Warmup] OCR 워밍업 실패 (무시):", (err as Error).message);
        }

        await recordHeartbeat("reservationReminder");
    }
);
