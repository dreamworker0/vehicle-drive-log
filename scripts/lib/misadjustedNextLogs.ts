/**
 * 수정 화면의 '직후 기록' 오조회로 출발 km가 덮어써진 운행일지를 찾는다.
 * (scripts/repairMisadjustedNextLogs.ts가 쓴다)
 *
 * ## 무슨 일이 있었나
 * `getAdjacentDriveLogs`가 직후 기록을 "뒤 기록 내림차순 10건의 마지막"으로 골라, 뒤 기록이
 * 10건을 넘으면 끝에서 10번째 기록을 집었다. 수정 저장 뒤 `adjustAdjacentLogs`가 그 기록의
 * 출발 km를 **수정한 기록의 도착 km**로 덮어써서, 엉뚱한 최근 기록의 주행거리가 늘었다.
 *
 * ## 어떻게 알아보나
 * `adjustAdjacentLogs`는 출발 km만 바꾸고 `distance`는 건드리지 않았다. 그래서 피해 기록은
 *   - `distance`가 원래 거리 그대로 남아 `도착 − 출발`과 어긋나고(**원래 출발 = 도착 − distance**),
 *   - 출발 km가 훨씬 앞 기록의 도착 km라 **바로 앞 기록의 도착 km보다 작다**(구간이 겹친다).
 * 정상적인 인접 조정(바로 앞·뒤 기록을 맞춘 경우)은 앞 기록 도착과 이어지므로 겹치지 않는다.
 * 그 뒤 서버 재정합이 기록을 밀었더라도 출발·도착을 같은 폭으로 옮기므로 위 관계는 유지된다.
 */

export interface DriveLogKmRow {
    id: string;
    /** 운행 시각(ms) */
    timestampMs: number;
    startKm: unknown;
    endKm: unknown;
    distance: unknown;
    /** 수정된 적이 있는가 — `adjustAdjacentLogs`는 늘 editedAt을 남겼다 */
    edited: boolean;
}

export type RepairConfidence =
    /** 되돌린 출발이 바로 앞 기록의 도착과 정확히 이어진다 */
    | 'exact'
    /** 되돌린 출발이 바로 앞 기록 도착보다 크다 — 그 사이에 기록하지 않은 운행이 있었다 */
    | 'gap'
    /** 되돌려도 앞 기록과 여전히 겹친다 — 다른 원인이 섞였을 수 있어 사람이 본다 */
    | 'manual';

export interface MisadjustedLog {
    id: string;
    prevId: string;
    timestampMs: number;
    startKm: number;
    endKm: number;
    distance: number;
    prevEndKm: number;
    /** 되돌릴 출발 km (= 도착 − distance) */
    restoredStartKm: number;
    /** 지금 잘못 붙은 거리 (= 되돌린 출발 − 지금 출발) */
    inflatedKm: number;
    confidence: RepairConfidence;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 한 차량의 운행일지에서 출발 km가 덮어써진 기록을 찾는다(입력 순서는 상관없다). */
export function findMisadjustedNextLogs(rows: DriveLogKmRow[]): MisadjustedLog[] {
    const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
    const found: MisadjustedLog[] = [];

    for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const prev = sorted[i - 1];
        if (!cur.edited) continue;
        if (!isNum(cur.startKm) || !isNum(cur.endKm) || !isNum(cur.distance) || !isNum(prev.endKm)) continue;

        // 출발 km가 바로 앞 기록의 도착보다 작아 구간이 겹친다
        if (cur.startKm >= prev.endKm) continue;
        // distance가 지금 출발·도착과 어긋난다(출발만 바뀌었다)
        if (cur.distance === cur.endKm - cur.startKm) continue;

        const restoredStartKm = cur.endKm - cur.distance;
        // 덮어쓰기로 거리가 **늘어난** 경우만 본다(이 결함은 출발을 앞당기기만 한다)
        if (cur.distance < 0 || restoredStartKm < 0 || restoredStartKm <= cur.startKm) continue;

        const confidence: RepairConfidence =
            restoredStartKm === prev.endKm ? 'exact'
                : restoredStartKm > prev.endKm ? 'gap'
                    : 'manual';

        found.push({
            id: cur.id,
            prevId: prev.id,
            timestampMs: cur.timestampMs,
            startKm: cur.startKm,
            endKm: cur.endKm,
            distance: cur.distance,
            prevEndKm: prev.endKm,
            restoredStartKm,
            inflatedKm: restoredStartKm - cur.startKm,
            confidence,
        });
    }
    return found;
}

/**
 * 자동으로 되돌려도 되는가 — **앞 기록과 정확히 이어지는 'exact'만.**
 *
 * 'gap'은 되돌리면 앞에 빈 구간이 새로 생긴다. 전 기관 조회(2026-11-03)에서 나온 'gap' 1건은
 * 관리자가 그날 같은 차량 기록을 여러 건 고치고 서버 재정합까지 겹친 경우라, 되돌리면 239km
 * 빈 구간이 생겼다 — 이 결함 하나로 설명되지 않는다. 'gap'·'manual'은 목록에만 올리고 사람이 본다.
 */
export const isAutoRepairable = (log: MisadjustedLog): boolean => log.confidence === 'exact';
