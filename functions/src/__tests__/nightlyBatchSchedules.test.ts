/**
 * nightlyBatchSchedules.test.ts
 *
 * 야간 배치 3종의 **배포 설정** 회귀 가드.
 *
 * 2026-08-28 Cloud Run 비용 점검에서 dailyNightlyBatch가 청구 대상 인스턴스 시간 1위
 * (2위 그룹의 5배)로 나왔다. 원인은 성격이 다른 일곱 스텝을 한 함수에 몰아넣고 1GiB·540초로
 * 매일 돌린 것이었고, 이를 셋으로 쪼개 각각 512MiB로 되돌렸다.
 *
 * 이 테스트가 지키는 것은 비즈니스 로직이 아니라 **비용 설정 그 자체**다. 메모리를 다시 1GiB로
 * 올리거나 주간 배치를 매일로 되돌리는 변경은 화면에서 아무 증상도 내지 않고 청구서에서만
 * 드러난다 — 그래서 코드 리뷰가 놓치기 쉽다. 여기서 잡는다.
 *
 * 값을 바꿔야 할 이유가 생겼다면 이 테스트를 함께 고치면서 그 이유를 남길 것.
 */

// 모듈 로드 부작용 차단 — 이 테스트는 __endpoint 메타데이터만 본다.
jest.mock("firebase-admin/firestore", () => ({
    getFirestore: () => ({ collection: () => ({}) }),
    FieldValue: { serverTimestamp: () => "ts" },
    Timestamp: { fromMillis: (n: number) => n },
}));
jest.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: () => ({}) }) }));
jest.mock("../core/sentry", () => ({ captureError: jest.fn(), captureWarning: jest.fn() }));
jest.mock("../services/statistics/computeDashboardStats", () => ({ computeAllDashboardStats: jest.fn() }));
jest.mock("../services/alimtalk/sendNotification", () => ({
    createInAppNotification: jest.fn(),
    sendPushToUser: jest.fn(),
}));

import { nightlyStatsBatch } from "../handlers/scheduled/nightlyStatsBatch";
import { dailyNightlyBatch } from "../handlers/scheduled/dailyNightlyBatch";
import { weeklyMaintenanceBatch } from "../handlers/scheduled/weeklyMaintenanceBatch";

interface ScheduleEndpoint {
    availableMemoryMb: number | null;
    timeoutSeconds: number | null;
    scheduleTrigger: {
        schedule: string;
        timeZone: string;
        retryConfig: { retryCount: number };
    };
}

const endpointOf = (fn: unknown): ScheduleEndpoint =>
    (fn as { __endpoint: ScheduleEndpoint }).__endpoint;

const BATCHES = {
    nightlyStatsBatch,
    dailyNightlyBatch,
    weeklyMaintenanceBatch,
} as const;

describe("야간 배치 3종 — 비용 설정 회귀 가드", () => {
    it.each(Object.keys(BATCHES))(
        "%s는 512MiB를 넘지 않는다 — 1GiB는 vCPU·메모리 요금을 함께 올린다",
        (name) => {
            const ep = endpointOf(BATCHES[name as keyof typeof BATCHES]);
            expect(ep.availableMemoryMb).toBe(512);
        }
    );

    // 리전은 core/firebase의 setGlobalOptions가 배포 시점에 넣어 주므로 여기서는 검사하지 않는다
    // (이 테스트는 전역 설정을 로드하지 않는다 — 로드하면 admin 초기화까지 딸려 온다).
    it.each(Object.keys(BATCHES))("%s는 KST 기준으로 돈다 (rules/cloud-functions.md §3.1)", (name) => {
        const ep = endpointOf(BATCHES[name as keyof typeof BATCHES]);
        expect(ep.scheduleTrigger.timeZone).toBe("Asia/Seoul");
    });

    it("집계 배치는 02:00을 지킨다 — dailyAggregation이 실행 시각 -3h를 기준월로 삼는다", () => {
        const ep = endpointOf(nightlyStatsBatch);
        expect(ep.scheduleTrigger.schedule).toBe("0 2 * * *");
        // 집계는 다음 날 배치가 같은 창을 다시 집계해 스스로 메우므로 재실행 비용을 물지 않는다.
        expect(ep.scheduleTrigger.retryConfig.retryCount).toBe(0);
    });

    it("백업 배치는 집계와 겹치지 않게 02:20으로 물려 있고, 재시도는 살려 둔다", () => {
        const ep = endpointOf(dailyNightlyBatch);
        expect(ep.scheduleTrigger.schedule).toBe("20 2 * * *");
        // 백업은 하루 놓치면 그날치가 영영 없다. 두 스텝 모두 멱등이라 재실행이 안전하다.
        expect(ep.scheduleTrigger.retryConfig.retryCount).toBe(1);
    });

    it("유지보수 배치는 매일이 아니라 주 1회다 — 판정 기준이 30일·3년이라 매일 돌 이유가 없다", () => {
        const ep = endpointOf(weeklyMaintenanceBatch);
        expect(ep.scheduleTrigger.schedule).toBe("0 3 * * 0");
        expect(ep.scheduleTrigger.retryConfig.retryCount).toBe(0);
    });

    it("세 배치의 실행 시각이 서로 겹치지 않는다 — 동시 실행은 피크 인스턴스를 늘린다", () => {
        const schedules = Object.values(BATCHES).map((fn) => endpointOf(fn).scheduleTrigger.schedule);
        // "분 시" 조합이 서로 달라야 한다
        const minuteHour = schedules.map((s) => s.split(" ").slice(0, 2).join(" "));
        expect(new Set(minuteHour).size).toBe(schedules.length);
    });
});
