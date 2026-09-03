import { getLastScheduledTick, evaluateSchedulerStatus, resolveFailureStatus, evaluateCalendarSyncStatus } from "../handlers/https/apiHealthCheck";

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

describe("apiHealthCheck — 핑 실패 등급 판정", () => {
    /** AbortSignal.timeout이 만드는 것과 같은 모양의 에러 */
    const timeoutErr = Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
    });

    it("degradeOnTimeout이 켜져 있으면 타임아웃은 degraded로 낮춘다", () => {
        expect(resolveFailureStatus(timeoutErr, true)).toBe("degraded");
    });

    it("런타임이 cause에 실어 보내도 타임아웃으로 본다", () => {
        const wrapped = Object.assign(new Error("fetch failed"), { cause: { name: "TimeoutError" } });
        expect(resolveFailureStatus(wrapped, true)).toBe("degraded");
    });

    it("degradeOnTimeout이 꺼져 있으면 타임아웃도 error다", () => {
        // 사용자 경로가 실시간 호출에 걸린 API(T맵·Gemini 등)는 느린 것도 장애다
        expect(resolveFailureStatus(timeoutErr, false)).toBe("error");
    });

    it("타임아웃이 아닌 실패는 낮추지 않는다", () => {
        // 상태 코드 에러는 키·엔드포인트 문제라 조치가 필요하다
        expect(resolveFailureStatus(new Error("HTTP 401"), true)).toBe("error");
        expect(resolveFailureStatus(new Error("HOLIDAY_API_KEY 미설정"), true)).toBe("error");
    });

    it("에러가 아닌 값이 와도 터지지 않고 error로 본다", () => {
        expect(resolveFailureStatus(null, true)).toBe("error");
        expect(resolveFailureStatus(undefined, true)).toBe("error");
        expect(resolveFailureStatus("timeout", true)).toBe("error");
    });
});

describe("apiHealthCheck — 캘린더 동기화 판정", () => {
    /** 집계 결과 골격 — 각 테스트는 필요한 수치만 덮어쓴다 */
    const stat = (o: Partial<Parameters<typeof evaluateCalendarSyncStatus>[0]> = {}) => ({
        totalLinked: 100, activeLinked: 100, failedCount: 0,
        permanentlyDisabled: 0, cooldownCount: 0, excludedCount: 0, ...o,
    });

    it("실패가 없으면 정상", () => {
        expect(evaluateCalendarSyncStatus(stat()).status).toBe("ok");
    });

    it("영구중단 1대가 시스템 전체를 error로 만들지 않는다", () => {
        // 예전에는 permanentlyDisabled > 0이면 조건 없이 error였다. 그 카운터는 수동 리셋
        // 전까지 내려가지 않으므로 **한 번 빨개지면 영원히 빨간** 상태가 됐다.
        const r = evaluateCalendarSyncStatus(stat({ failedCount: 1, permanentlyDisabled: 1 }));
        expect(r.status).toBe("degraded");
    });

    it("실패 비율이 임계(30%)를 넘으면 error로 올린다", () => {
        const r = evaluateCalendarSyncStatus(stat({ failedCount: 31, permanentlyDisabled: 31 }));
        expect(r.status).toBe("error");
    });

    it("임계 경계(정확히 30%)는 아직 degraded", () => {
        expect(evaluateCalendarSyncStatus(stat({ failedCount: 30, permanentlyDisabled: 30 })).status).toBe("degraded");
    });

    it("분모는 동기화가 실제로 도는 차량이다 — 제외분은 비율에 끼지 않는다", () => {
        // 연동 100대 중 40대가 기능 OFF·고아 기관이라면, 실패 20/60(33%)이 실제 상황이다
        const r = evaluateCalendarSyncStatus(stat({
            totalLinked: 100, activeLinked: 60, failedCount: 20, permanentlyDisabled: 20, excludedCount: 40,
        }));
        expect(r.status).toBe("error");
        expect(r.statusDetail).toContain("20/60");
        expect(r.statusDetail).toContain("33%");
        // 왜 숫자가 줄었는지 화면에서 설명한다
        expect(r.statusDetail).toContain("40대 제외");
    });

    it("영구중단과 쿨다운을 나눠 보여준다 (조치가 다르다)", () => {
        const r = evaluateCalendarSyncStatus(stat({ failedCount: 5, permanentlyDisabled: 3, cooldownCount: 2 }));
        expect(r.statusDetail).toContain("영구중단 3");
        expect(r.statusDetail).toContain("쿨다운 2");
    });

    it("연동 차량이 하나도 없으면 0으로 나누지 않는다", () => {
        expect(evaluateCalendarSyncStatus(stat({ activeLinked: 0 })).status).toBe("ok");
    });
});
