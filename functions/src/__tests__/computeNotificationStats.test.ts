/**
 * computeNotificationStats.test.ts
 * - 알림 요약·일별·타입별 집계 순수 함수 단위 테스트 (ALL 스코프 캐시 이관)
 * - createdAt은 { toDate }만 가진 가짜 Timestamp로 KST 버킷팅을 검증
 */
import { computeNotificationStats } from "../services/statistics/dashboardSections";

function fakeDoc(data: Record<string, unknown>): FirebaseFirestore.QueryDocumentSnapshot {
    return { data: () => data } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
}

/** UTC 인스턴트를 가리키는 가짜 Firestore Timestamp */
function fakeTs(iso: string): { toDate: () => Date } {
    return { toDate: () => new Date(iso) };
}

describe("computeNotificationStats", () => {
    // 고정 윈도우 시작일 (KST) — 30일 키: 6/1 ~ 6/30
    const thirtyDaysAgoStr = "2026-06-01";

    it("빈 입력이면 30일 키 0 채움 + 주입된 totals로 요약을 계산한다", () => {
        const r = computeNotificationStats([], { total: 10, read: 4 }, thirtyDaysAgoStr, null);

        expect(r.notifSummary).toEqual({ total: 10, read: 4, unread: 6, readRate: 40 });
        expect(r.dailyNotifStats).toHaveLength(30);
        expect(r.dailyNotifStats[0]).toEqual({ date: "6/1", sent: 0, read: 0 });
        expect(r.dailyNotifStats.every(d => d.sent === 0 && d.read === 0)).toBe(true);
        expect(r.notifTypeCounts).toEqual([]);
    });

    it("readRate는 반올림, total=0이면 0", () => {
        expect(computeNotificationStats([], { total: 3, read: 1 }, thirtyDaysAgoStr, null).notifSummary.readRate).toBe(33);
        expect(computeNotificationStats([], { total: 0, read: 0 }, thirtyDaysAgoStr, null).notifSummary.readRate).toBe(0);
    });

    it("createdAt을 KST 날짜로 버킷팅한다 (UTC 15:00 = KST 다음날 00:00)", () => {
        const docs = [
            // UTC 6/9 15:30 = KST 6/10 00:30 → '6/10' 버킷
            fakeDoc({ createdAt: fakeTs("2026-06-09T15:30:00Z"), type: "notice", read: true }),
            // UTC 6/10 10:00 = KST 6/10 19:00 → 같은 '6/10' 버킷
            fakeDoc({ createdAt: fakeTs("2026-06-10T10:00:00Z"), type: "notice" }),
        ];
        const r = computeNotificationStats(docs, { total: 2, read: 1 }, thirtyDaysAgoStr, null);

        expect(r.dailyNotifStats.find(d => d.date === "6/10")).toEqual({ date: "6/10", sent: 2, read: 1 });
        expect(r.dailyNotifStats.find(d => d.date === "6/9")).toEqual({ date: "6/9", sent: 0, read: 0 });
    });

    it("윈도우 이전 문서는 일별에서 제외하되 타입 분포에는 포함한다 (라이브 로더 패리티)", () => {
        const docs = [
            fakeDoc({ createdAt: fakeTs("2026-05-20T03:00:00Z"), type: "approval" }), // KST 5/20 — 윈도우 밖
            fakeDoc({ createdAt: fakeTs("2026-06-15T03:00:00Z"), type: "approval" }),
        ];
        const r = computeNotificationStats(docs, { total: 2, read: 0 }, thirtyDaysAgoStr, null);

        expect(r.dailyNotifStats.reduce((s, d) => s + d.sent, 0)).toBe(1);
        expect(r.notifTypeCounts).toEqual([{ type: "approval", count: 2 }]);
    });

    it("type 누락은 'system'으로 귀속하고 count 내림차순 정렬한다", () => {
        const docs = [
            fakeDoc({ createdAt: fakeTs("2026-06-05T03:00:00Z") }),
            fakeDoc({ createdAt: fakeTs("2026-06-05T04:00:00Z") }),
            fakeDoc({ createdAt: fakeTs("2026-06-05T05:00:00Z"), type: "notice" }),
        ];
        const r = computeNotificationStats(docs, { total: 3, read: 0 }, thirtyDaysAgoStr, null);

        expect(r.notifTypeCounts).toEqual([
            { type: "system", count: 2 },
            { type: "notice", count: 1 },
        ]);
    });

    it("orgFilterId가 주어지면 다른 기관 문서는 제외한다", () => {
        const docs = [
            fakeDoc({ createdAt: fakeTs("2026-06-05T03:00:00Z"), type: "notice", organizationId: "orgA" }),
            fakeDoc({ createdAt: fakeTs("2026-06-05T03:00:00Z"), type: "notice", organizationId: "orgB" }),
        ];
        const r = computeNotificationStats(docs, { total: 2, read: 0 }, thirtyDaysAgoStr, "orgA");

        expect(r.dailyNotifStats.find(d => d.date === "6/5")?.sent).toBe(1);
        expect(r.notifTypeCounts).toEqual([{ type: "notice", count: 1 }]);
    });
});
