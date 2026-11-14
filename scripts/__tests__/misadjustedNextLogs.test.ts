import { describe, expect, it } from "vitest";
import { findMisadjustedNextLogs, isAutoRepairable, type DriveLogKmRow } from "../lib/misadjustedNextLogs";

/** day일 09시 기록 — distance는 저장 당시 거리(따로 주지 않으면 도착 − 출발) */
const row = (id: string, day: number, startKm: number, endKm: number, extra: Partial<DriveLogKmRow> = {}): DriveLogKmRow => ({
    id,
    timestampMs: new Date(2026, 9, day, 9).getTime(),
    startKm,
    endKm,
    distance: endKm - startKm,
    edited: false,
    ...extra,
});

describe("findMisadjustedNextLogs — 직후 기록 오조회로 덮어써진 출발 km", () => {
    it("엉뚱한 최근 기록의 출발이 지난 기록의 도착으로 덮어써졌으면 찾아 원래 출발을 돌려준다", () => {
        // A(1일, 도착 52,000)를 고쳐 저장했더니 끝에서 10번째인 K(20일)의 출발이 52,000으로 바뀌었다.
        // K의 distance(30)는 그대로 남아 있다 → 원래 출발 = 52,730 − 30 = 52,700 = 바로 앞 J의 도착
        const logs = [
            row("A", 1, 51_950, 52_000, { edited: true }),
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_000, 52_730, { distance: 30, edited: true }),
            row("L", 21, 52_730, 52_760),
        ];

        const found = findMisadjustedNextLogs(logs);

        expect(found).toEqual([
            expect.objectContaining({
                id: "K", prevId: "J", startKm: 52_000, restoredStartKm: 52_700, inflatedKm: 700, confidence: "exact",
            }),
        ]);
        expect(isAutoRepairable(found[0])).toBe(true);
    });

    it("되돌린 출발이 앞 기록 도착보다 크면 'gap'으로 올리되, 빈 구간이 새로 생기므로 자동 복구하지 않는다", () => {
        const found = findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_000, 52_750, { distance: 30, edited: true }), // 원래 52,720 — 20km 빈 구간
        ]);
        expect(found[0]).toMatchObject({ restoredStartKm: 52_720, confidence: "gap" });
        expect(isAutoRepairable(found[0])).toBe(false);
    });

    it("되돌려도 앞 기록과 겹치면 'manual'로만 올리고 자동 복구하지 않는다", () => {
        const found = findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_000, 52_710, { distance: 30, edited: true }), // 원래 52,680 < 52,700
        ]);
        expect(found[0]).toMatchObject({ restoredStartKm: 52_680, confidence: "manual" });
        expect(isAutoRepairable(found[0])).toBe(false);
    });

    it("정상적인 인접 조정(바로 앞 기록 도착과 이어짐)은 거리가 달라졌어도 건드리지 않는다", () => {
        // 바로 다음 기록을 맞춘 경우 출발 = 앞 기록 도착이라 구간이 겹치지 않는다
        expect(findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_700, 52_750, { distance: 30, edited: true }),
        ])).toEqual([]);
    });

    it("겹쳐도 distance가 출발·도착과 맞으면 손으로 그렇게 적은 것이라 건드리지 않는다", () => {
        expect(findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_690, 52_720, { edited: true }),
        ])).toEqual([]);
    });

    it("수정된 적이 없거나 distance가 없는 기록은 근거가 없어 건너뛴다", () => {
        expect(findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_000, 52_730, { distance: 30, edited: false }),
        ])).toEqual([]);
        expect(findMisadjustedNextLogs([
            row("J", 19, 52_650, 52_700),
            row("K", 20, 52_000, 52_730, { distance: undefined, edited: true }),
        ])).toEqual([]);
    });

    it("입력 순서와 무관하게 시각순으로 앞 기록을 정한다", () => {
        const found = findMisadjustedNextLogs([
            row("K", 20, 52_000, 52_730, { distance: 30, edited: true }),
            row("A", 1, 51_950, 52_000),
            row("J", 19, 52_650, 52_700),
        ]);
        expect(found.map(f => [f.id, f.prevId])).toEqual([["K", "J"]]);
    });
});
