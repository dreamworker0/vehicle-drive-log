/**
 * computeReservationStats.test.ts
 * - 예약 집계 순수 함수 단위(특성화) 테스트
 * - Firestore 호출이 없으므로 .data()만 가진 가짜 doc으로 검증
 */
import { computeReservationStats } from "../services/statistics/dashboardSections";

type ResData = Record<string, unknown>;

// QueryDocumentSnapshot 형태를 흉내내는 최소 가짜 doc (data()만 사용됨)
function fakeDoc(data: ResData): FirebaseFirestore.QueryDocumentSnapshot {
    return { data: () => data } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
}

// 입력 date 문자열을 thirtyDaysAgo/todayStart 기준 offset일로 생성
function dateStrFrom(base: Date, offsetDays: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("computeReservationStats", () => {
    // 고정 기준일: 결정적 테스트를 위해 명시적 Date 사용
    const thirtyDaysAgo = new Date(2026, 5, 1); // 2026-06-01 (로컬)
    const todayStart = new Date(2026, 5, 21); // 2026-06-21 (로컬)

    it("빈 입력이면 모든 ratio total=0, 시계열은 30일 키로 0 채움", () => {
        const r = computeReservationStats([], thirtyDaysAgo, todayStart, null);

        expect(r.quickDriveRatio).toEqual({ total: 0, quick: 0, regular: 0, rate: 0 });
        expect(r.recommendationRatio.total).toBe(0);
        expect(r.reservationTypeRatio.total).toBe(0);
        expect(r.futureReservationTypeRatio.total).toBe(0);

        // 30일 시계열 길이 + 전부 0
        expect(r.quickDriveStats).toHaveLength(30);
        expect(r.reservationTypeStats).toHaveLength(30);
        expect(r.futureReservationTypeStats).toHaveLength(30);
        expect(r.quickDriveStats.every(s => s.quick === 0 && s.regular === 0)).toBe(true);
    });

    it("quick/regular, recommendation/normal, single/multiDay/recurring 분류", () => {
        const day = dateStrFrom(thirtyDaysAgo, 2); // 범위 내(thirtyDaysAgo 이후)
        const docs = [
            // 빠른배차 + 추천 + 단일
            fakeDoc({ date: day, isQuickDrive: true, source: "recommendation" }),
            // 일반 + 일반 + 다일(groupId)
            fakeDoc({ date: day, groupId: "g1" }),
            // 일반 + 일반 + 반복(recurringGroupId)
            fakeDoc({ date: day, recurringGroupId: "r1" }),
        ];

        const r = computeReservationStats(docs, thirtyDaysAgo, todayStart, null);

        expect(r.quickDriveRatio).toEqual({ total: 3, quick: 1, regular: 2, rate: 33 });
        expect(r.recommendationRatio).toEqual({ total: 3, recommendation: 1, normal: 2, rate: 33 });
        expect(r.reservationTypeRatio.single).toBe(1);
        expect(r.reservationTypeRatio.multiDay).toBe(1);
        expect(r.reservationTypeRatio.recurring).toBe(1);
        expect(r.reservationTypeRatio.total).toBe(3);
    });

    it("취소(cancelled) 예약은 집계에서 제외", () => {
        const day = dateStrFrom(thirtyDaysAgo, 3);
        const docs = [
            fakeDoc({ date: day, status: "cancelled", isQuickDrive: true }),
            fakeDoc({ date: day }),
        ];
        const r = computeReservationStats(docs, thirtyDaysAgo, todayStart, null);
        expect(r.quickDriveRatio.total).toBe(1);
        expect(r.quickDriveRatio.quick).toBe(0);
    });

    it("orgFilterId가 주어지면 다른 기관 예약은 제외", () => {
        const day = dateStrFrom(thirtyDaysAgo, 4);
        const docs = [
            fakeDoc({ date: day, organizationId: "orgA" }),
            fakeDoc({ date: day, organizationId: "orgB" }),
        ];
        const r = computeReservationStats(docs, thirtyDaysAgo, todayStart, "orgA");
        expect(r.reservationTypeRatio.total).toBe(1);
    });

    it("동일 calendarEventId+date는 1회만 집계(중복 제거)", () => {
        const day = dateStrFrom(thirtyDaysAgo, 5);
        const docs = [
            fakeDoc({ date: day, calendarEventId: "evt1" }),
            fakeDoc({ date: day, calendarEventId: "evt1" }), // 중복
        ];
        const r = computeReservationStats(docs, thirtyDaysAgo, todayStart, null);
        expect(r.reservationTypeRatio.total).toBe(1);
    });

    it("미래(todayStart 이후) 예약은 futureReservationType에 집계", () => {
        const futureDay = dateStrFrom(todayStart, 5); // 미래
        const pastDay = dateStrFrom(thirtyDaysAgo, 1); // 과거(미래 아님)
        const docs = [
            fakeDoc({ date: futureDay, recurringGroupId: "r1" }),
            fakeDoc({ date: pastDay }),
        ];
        const r = computeReservationStats(docs, thirtyDaysAgo, todayStart, null);
        expect(r.futureReservationTypeRatio.total).toBe(1);
        expect(r.futureReservationTypeRatio.recurring).toBe(1);
    });

    it("thirtyDaysAgo에 시각이 실려도 윈도우 첫날 예약을 누락하지 않는다 (정규화 회귀)", () => {
        // 실제 호출자는 new Date(Date.now() - 29d)로 시각(시/분/초)이 실린 값을 넘긴다.
        const withTime = new Date(2026, 5, 1, 14, 30, 0); // 2026-06-01 14:30 (자정 아님)
        const boundaryDay = dateStrFrom(withTime, 0); // 윈도우 첫날 = 2026-06-01 (parsed는 자정)
        const docs = [fakeDoc({ date: boundaryDay })];

        const r = computeReservationStats(docs, withTime, todayStart, null);

        // 정규화 전에는 parsed(00:00) >= thirtyDaysAgo(14:30) === false 라 첫날이 누락되어 total=0이었다.
        expect(r.reservationTypeRatio.total).toBe(1);
        expect(r.reservationTypeStats.find(s => s.date === "6/1")?.single).toBe(1);
    });

    it("반환 객체가 dashboardTimeSeries 기대 8개 키를 모두 포함", () => {
        const r = computeReservationStats([], thirtyDaysAgo, todayStart, null);
        expect(Object.keys(r).sort()).toEqual([
            "futureReservationTypeRatio", "futureReservationTypeStats",
            "quickDriveRatio", "quickDriveStats",
            "recommendationRatio", "recommendationStats",
            "reservationTypeRatio", "reservationTypeStats",
        ]);
    });
});
