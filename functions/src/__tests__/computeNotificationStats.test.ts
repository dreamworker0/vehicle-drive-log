/**
 * computeNotificationStats.test.ts
 * - 알림 요약·일별·타입별 통계 조립 순수 함수 단위 테스트 (ALL 스코프 캐시 이관)
 * - 원본 문서 스캔 제거 후: 호출자가 count 집계쿼리로 구한 수치를 조립만 하는지 검증
 *   (요약 계산, 'other' 잔여 귀속, count 내림차순 정렬, 0건 타입 제외)
 */
import { computeNotificationStats, KNOWN_NOTIF_TYPES } from "../services/statistics/dashboardSections";

/** 30일 일별 배열 생성 헬퍼 — 지정한 키만 덮어쓰고 나머지는 0 */
function dailyStats(overrides: Record<string, { sent: number; read: number }> = {}): { date: string; sent: number; read: number }[] {
    const days: { date: string; sent: number; read: number }[] = [];
    for (let i = 1; i <= 30; i++) {
        const key = `6/${i}`;
        days.push({ date: key, sent: 0, read: 0, ...(overrides[key] || {}) });
    }
    return days;
}

describe("computeNotificationStats", () => {
    it("빈 일별·타입 입력이면 30일 0 채움 + 주입된 totals로 요약을 계산한다", () => {
        const r = computeNotificationStats(dailyStats(), [], { total: 10, read: 4 });

        expect(r.notifSummary).toEqual({ total: 10, read: 4, unread: 6, readRate: 40 });
        expect(r.dailyNotifStats).toHaveLength(30);
        expect(r.dailyNotifStats[0]).toEqual({ date: "6/1", sent: 0, read: 0 });
        expect(r.dailyNotifStats.every(d => d.sent === 0 && d.read === 0)).toBe(true);
        expect(r.notifTypeCounts).toEqual([]);
    });

    it("readRate는 반올림, total=0이면 0", () => {
        expect(computeNotificationStats(dailyStats(), [], { total: 3, read: 1 }).notifSummary.readRate).toBe(33);
        expect(computeNotificationStats(dailyStats(), [], { total: 0, read: 0 }).notifSummary.readRate).toBe(0);
    });

    it("일별 통계는 그대로 통과시킨다", () => {
        const daily = dailyStats({ "6/10": { sent: 2, read: 1 } });
        const r = computeNotificationStats(daily, [{ type: "notice", count: 2 }], { total: 2, read: 1 });

        expect(r.dailyNotifStats.find(d => d.date === "6/10")).toEqual({ date: "6/10", sent: 2, read: 1 });
        expect(r.dailyNotifStats.find(d => d.date === "6/9")).toEqual({ date: "6/9", sent: 0, read: 0 });
    });

    it("타입 count는 내림차순 정렬하고 0건 타입은 제외한다", () => {
        const daily = dailyStats({ "6/5": { sent: 3, read: 0 } });
        const r = computeNotificationStats(
            daily,
            [
                { type: "system", count: 2 },
                { type: "approval", count: 0 },
                { type: "notice", count: 1 },
            ],
            { total: 3, read: 0 },
        );

        expect(r.notifTypeCounts).toEqual([
            { type: "system", count: 2 },
            { type: "notice", count: 1 },
        ]);
    });

    it("알려진 타입 합보다 발송 총량이 크면 잔여를 'other'로 귀속한다", () => {
        const daily = dailyStats({ "6/5": { sent: 5, read: 0 } });
        const r = computeNotificationStats(daily, [{ type: "notice", count: 2 }], { total: 5, read: 0 });

        expect(r.notifTypeCounts).toEqual([
            { type: "other", count: 3 },
            { type: "notice", count: 2 },
        ]);
    });

    it("발송 총량과 알려진 타입 합이 같으면 'other'를 만들지 않는다", () => {
        const daily = dailyStats({ "6/5": { sent: 2, read: 0 } });
        const r = computeNotificationStats(daily, [{ type: "notice", count: 2 }], { total: 2, read: 0 });

        expect(r.notifTypeCounts).toEqual([{ type: "notice", count: 2 }]);
    });

    it("KNOWN_NOTIF_TYPES에 핵심 타입들이 등록되어 있다 (count 쿼리 대상 누락 회귀 방지)", () => {
        for (const t of ["system", "notice", "admin_notice", "reservation_confirmed", "drive_log_reminder", "approval"]) {
            expect(KNOWN_NOTIF_TYPES).toContain(t);
        }
    });
});
