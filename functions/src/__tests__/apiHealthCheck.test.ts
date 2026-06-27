import { getLastScheduledTick, evaluateSchedulerStatus } from "../handlers/https/apiHealthCheck";

// 평일 08~18시 매시 정각 (예약 알림과 동일)
const WEEKDAY_BIZ = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 };

/** KST(UTC+9) 기준 시각을 epoch ms로 만든다 */
function kst(y: number, mo: number, d: number, h: number, mi = 0): number {
    return Date.UTC(y, mo - 1, d, h - 9, mi, 0, 0);
}

describe("apiHealthCheck — 스케줄러 상태 판정", () => {
    describe("getLastScheduledTick()", () => {
        it("활성 창 안(평일 업무시간)이면 현재 정각을 반환", () => {
            // 2026-06-26(금) 10:30 KST → 직전 틱은 같은 날 10:00 KST
            const now = new Date(kst(2026, 6, 26, 10, 30));
            const tick = getLastScheduledTick(now, WEEKDAY_BIZ);
            expect(tick).toBe(kst(2026, 6, 26, 10, 0));
        });

        it("주말이면 직전 평일 마지막 정각(금 18:00)을 반환", () => {
            // 2026-06-27(토) 20:00 KST → 직전 틱은 2026-06-26(금) 18:00 KST
            const now = new Date(kst(2026, 6, 27, 20, 0));
            const tick = getLastScheduledTick(now, WEEKDAY_BIZ);
            expect(tick).toBe(kst(2026, 6, 26, 18, 0));
        });

        it("야간(창 시작 전)이면 전날 마지막 정각을 반환", () => {
            // 2026-06-26(금) 05:00 KST → 직전 틱은 2026-06-25(목) 18:00 KST
            const now = new Date(kst(2026, 6, 26, 5, 0));
            const tick = getLastScheduledTick(now, WEEKDAY_BIZ);
            expect(tick).toBe(kst(2026, 6, 25, 18, 0));
        });
    });

    describe("evaluateSchedulerStatus() — activeWindow 있음", () => {
        const cfg = { expectedIntervalMs: 70 * 60 * 1000, activeWindow: WEEKDAY_BIZ };

        it("주말: 금요일 마지막 실행 후 오래 지나도 정상(오탐 방지)", () => {
            const now = kst(2026, 6, 27, 20, 0); // 토 20:00
            const lastRun = kst(2026, 6, 26, 18, 0); // 금 18:00 (마지막 정상 실행)
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("ok");
        });

        it("평일 업무시간: 직전 정각에 실행됐으면 정상", () => {
            const now = kst(2026, 6, 26, 10, 30); // 금 10:30
            const lastRun = kst(2026, 6, 26, 10, 1); // 금 10:00 틱 실행
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("ok");
        });

        it("평일 업무시간: 직전 정각을 놓쳤으면 에러", () => {
            const now = kst(2026, 6, 26, 10, 30); // 금 10:30
            const lastRun = kst(2026, 6, 26, 8, 1); // 08:00 이후로 실행 안 됨
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("error");
        });

        it("정각 직후 유예시간 내에는 실행 진행 중일 수 있어 정상", () => {
            const now = kst(2026, 6, 26, 10, 5); // 금 10:05 (틱 후 5분)
            const lastRun = kst(2026, 6, 26, 9, 1); // 아직 10:00 실행 기록 없음
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("ok");
        });

        it("실행 기록 없음(null)은 degraded", () => {
            const now = kst(2026, 6, 26, 10, 30);
            expect(evaluateSchedulerStatus(null, now, cfg)).toBe("degraded");
        });
    });

    describe("evaluateSchedulerStatus() — activeWindow 없음(상시)", () => {
        const cfg = { expectedIntervalMs: 32 * 24 * 60 * 60 * 1000 }; // 공휴일 동기화

        it("주기 내 실행이면 정상", () => {
            const now = kst(2026, 6, 27, 12, 0);
            const lastRun = now - 5 * 24 * 60 * 60 * 1000; // 5일 전
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("ok");
        });

        it("주기 초과면 에러", () => {
            const now = kst(2026, 6, 27, 12, 0);
            const lastRun = now - 40 * 24 * 60 * 60 * 1000; // 40일 전
            expect(evaluateSchedulerStatus(lastRun, now, cfg)).toBe("error");
        });
    });
});
