/**
 * schedulerCpuOptions.test.ts
 *
 * 가벼운 스케줄러 4종의 **CPU 할당 설정** 회귀 가드.
 *
 * firebase-functions v2는 메모리와 무관하게 모든 함수에 1 vCPU를 붙인다
 * (v2/options.d.ts: "Defaults to 1 for functions with <= 2GB RAM"). Cloud Run 요금은
 * vCPU-초가 GiB-초보다 약 10배 비싸므로, 외부 API 응답을 기다리는 시간이 대부분인
 * 스케줄러에 1 vCPU를 통째로 붙이는 것은 그대로 낭비다. gcf_gen1로 gen1의 분수 CPU를 쓴다.
 *
 * ## 이 테스트가 꼭 필요한 이유
 * `cpu`가 1 미만이면 `concurrency`는 1이어야 하는데, **firebase-functions는 이 조합을 정의
 * 시점에 검증하지 않는다.** 전역 옵션의 concurrency(80)가 그대로 얹힌 채 배포로 넘어가
 * 거기서 거부된다 — 즉 프로덕션 배포가 실패하기 전까지 아무도 모른다. 로컬 실측:
 *
 *     onSchedule({ cpu: "gcf_gen1", concurrency: 80, ... })
 *     → 통과함: {"cpu":"gcf_gen1","concurrency":80}   ← 던지지 않는다
 *
 * 그래서 두 값을 짝으로 고정한다. 새 스케줄러에 cpu만 넣고 concurrency를 빠뜨리는 것이
 * 정확히 이 테스트가 막으려는 실수다.
 *
 * ## 야간 배치 3종이 여기 없는 이유
 * nightlyStatsBatch·dailyNightlyBatch·weeklyMaintenanceBatch는 540초 상한에 여유가 없고
 * 문서 수만 건을 순회하는 CPU 작업이 섞여 있어, CPU를 1/3로 줄이면 타임아웃으로 통째로
 * 실패할 수 있다. 의도적으로 제외했다 — nightlyBatchSchedules.test.ts가 따로 지킨다.
 */

jest.mock("firebase-admin/firestore", () => ({
    getFirestore: () => ({ collection: () => ({}) }),
    FieldValue: { serverTimestamp: () => "ts" },
    Timestamp: { fromMillis: (n: number) => n },
}));
jest.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));
jest.mock("../core/sentry", () => ({ captureError: jest.fn(), captureWarning: jest.fn() }));
jest.mock("../core/discord", () => ({ sendDiscordAlert: jest.fn() }));
jest.mock("../services/alimtalk/reservationReminder", () => ({ checkReservationReminders: jest.fn() }));
jest.mock("../services/ocr/warmupOcr", () => ({ warmupOcrFunction: jest.fn() }));
jest.mock("../services/calendar/calendarSync", () => ({ listCalendarEvents: jest.fn(), parseEventToReservation: jest.fn() }));

import { syncCalendarToApp } from "../handlers/scheduled/calendarSchedule";
import { reservationReminder } from "../handlers/scheduled/reservationReminderScheduler";
import { monthlyBatch } from "../handlers/scheduled/monthlyBatch";
import { sendInactiveOrgAlimtalkScheduled } from "../handlers/scheduled/sendInactiveOrgAlimtalkScheduled";

interface ScheduleEndpoint {
    cpu?: number | string;
    concurrency?: number | null;
    timeoutSeconds: number | null;
    availableMemoryMb: number | null;
    scheduleTrigger?: { schedule?: string; timeZone?: string };
}

const endpointOf = (fn: unknown): ScheduleEndpoint =>
    (fn as { __endpoint: ScheduleEndpoint }).__endpoint;

const LIGHT_SCHEDULERS = {
    syncCalendarToApp,
    reservationReminder,
    monthlyBatch,
    sendInactiveOrgAlimtalkScheduled,
} as const;

describe("가벼운 스케줄러 4종 — CPU 할당 회귀 가드", () => {
    it.each(Object.keys(LIGHT_SCHEDULERS))(
        "%s는 gcf_gen1 분수 CPU를 쓴다 (기본값 1 vCPU는 대기 시간에 낭비된다)",
        (name) => {
            const ep = endpointOf(LIGHT_SCHEDULERS[name as keyof typeof LIGHT_SCHEDULERS]);
            expect(ep.cpu).toBe("gcf_gen1");
        }
    );

    it.each(Object.keys(LIGHT_SCHEDULERS))(
        "%s는 concurrency를 1로 명시한다 — 빠뜨리면 전역 80이 얹혀 배포가 거부된다",
        (name) => {
            const ep = endpointOf(LIGHT_SCHEDULERS[name as keyof typeof LIGHT_SCHEDULERS]);
            expect(ep.concurrency).toBe(1);
        }
    );

    it("reservationReminder는 08시 이후에만 돈다 — 임박 알림이 기대는 전제다", () => {
        // reservationReminder.ts §1의 쿼리 하한은 `startTime >= currentTime`뿐이다.
        // 다일 예약의 둘째 날 이후 문서(startTime "00:00")가 여기 걸리지 않는 이유는
        // 코드가 막아서가 아니라 **첫 실행이 08:00이라 하한이 항상 "00:00"보다 늦기 때문**이다.
        // 이 cron을 새벽까지 넓히면 그날부터 운행 중인 사람에게 "🚗 예약 임박"이 나가기 시작한다.
        // 넓혀야 한다면 §1에도 §3처럼 다일 판별을 넣고 나서 이 단언을 고쳐야 한다.
        const trigger = endpointOf(reservationReminder).scheduleTrigger;
        expect(trigger?.schedule).toBe("0 8-18 * * 1-5");
        expect(trigger?.timeZone).toBe("Asia/Seoul");
    });

    it("CPU를 줄인 만큼 타임아웃에 여유가 있다 — 전역 기본값 120초에 머물지 않는다", () => {
        // monthlyBatch는 원래 540초라 그대로. 나머지 셋은 120초에서 올렸다.
        expect(endpointOf(syncCalendarToApp).timeoutSeconds).toBe(300);
        expect(endpointOf(reservationReminder).timeoutSeconds).toBe(300);
        expect(endpointOf(sendInactiveOrgAlimtalkScheduled).timeoutSeconds).toBe(300);
        expect(endpointOf(monthlyBatch).timeoutSeconds).toBe(540);
    });
});
