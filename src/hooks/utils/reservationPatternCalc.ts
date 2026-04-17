/**
 * 예약 패턴 분석 — 순수 계산 유틸리티
 * useReservationPattern 훅에서 분리된 순수 함수들
 * IO 없이 입력 → 출력이 결정되므로 단위 테스트 가능
 */

// ─── 시간 변환 ───────────────────────────────────────────

export const timeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

export const minutesToTime = (totalMins: number): string => {
    let h = Math.floor(totalMins / 60);
    const m = Math.floor(totalMins % 60);
    if (h >= 24) h = 23;
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm}`;
};

// ─── 날짜 계산 ───────────────────────────────────────────

/** 다음 해당 요일의 날짜를 YYYY-MM-DD로 반환 (오늘 이후) */
export const getNextDateForWeekday = (targetWeekday: number): string => {
    const today = new Date();
    const currentWeekday = today.getDay();
    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) daysToAdd += 7;

    const nextDate = new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const y = nextDate.getFullYear();
    const m = String(nextDate.getMonth() + 1).padStart(2, '0');
    const d = String(nextDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/** 다음 평일 날짜 계산 (내일 기준, 주말이면 월요일로 이동) */
export const getNextWeekday = (): { dateStr: string; weekday: number } => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDay() === 6) tomorrow.setDate(tomorrow.getDate() + 2); // 토 → 월
    else if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1); // 일 → 월

    const weekday = tomorrow.getDay();
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${dd}`, weekday };
};

/** 날짜를 7일 뒤로 이동 */
export const advanceDateByWeek = (dateStr: string): string => {
    const dObj = new Date(dateStr + 'T00:00:00');
    dObj.setDate(dObj.getDate() + 7);
    const y = dObj.getFullYear();
    const m = String(dObj.getMonth() + 1).padStart(2, '0');
    const d = String(dObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// ─── 시간 충돌 검사 ──────────────────────────────────────

export const isTimeConflict = (start1: string, end1: string, start2: string, end2: string): boolean => {
    return start1 < end2 && start2 < end1;
};

// ─── 패턴 집계 ───────────────────────────────────────────

export interface ReservationInput {
    date: string;
    startTime: string;
    endTime?: string;
    vehicleId: string;
    vehicleName?: string;
    destination?: string;
}

export interface PatternResult {
    score: number;
    count: number;
    type: 'weekly' | 'daily' | 'dest-weekly' | 'dest-daily';
    targetWeekday?: number;
    reservation: ReservationInput;
    times: string[];
    vehicles: string[];
    durations: number[];
}

/** 목적지 빈도 상위 N개 추출 */
export function extractTopDestinations(reservations: ReservationInput[], topN = 3): string[] {
    const destCounter = new Map<string, number>();
    reservations.forEach(r => {
        const destLines = (r.destination || '').split(',').map(d => d.trim()).filter(Boolean);
        destLines.forEach(d => destCounter.set(d, (destCounter.get(d) || 0) + 1));
    });
    return Array.from(destCounter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(e => e[0])
        .slice(0, topN);
}

/** 차량별 전역 빈도 맵 생성 */
export function buildVehicleFrequency(reservations: ReservationInput[]): Map<string, number> {
    const counter = new Map<string, number>();
    for (const r of reservations) {
        if (r.vehicleId) {
            counter.set(r.vehicleId, (counter.get(r.vehicleId) || 0) + 1);
        }
    }
    return counter;
}

/** 다중 패턴 집계 (주간/일일/목적지 복합) */
export function aggregatePatterns(reservations: ReservationInput[]): Map<string, PatternResult> {
    const patternMap = new Map<string, PatternResult>();

    for (const r of reservations) {
        if (!r.date || !r.startTime || !r.vehicleId) continue;

        const d = new Date(r.date + 'T00:00:00');
        const weekday = d.getDay();
        const dest = (r.destination || '').trim();
        const timeWindow = r.startTime;

        const durationMins = r.endTime ? (timeToMinutes(r.endTime) - timeToMinutes(r.startTime)) : 0;
        const validDuration = durationMins > 0 ? durationMins : 60;

        const baseDestKey = dest || 'EMPTY_DEST';

        // 1. Weekly (매주 이 요일 + 시간)
        const wKey = `W_${weekday}_${timeWindow}_${baseDestKey}`;
        upsertPattern(patternMap, wKey, {
            score: 1.0, type: 'weekly', targetWeekday: weekday,
            reservation: r, timeWindow, vehicleId: r.vehicleId, duration: validDuration,
        });

        // 2. Daily (요일 무관)
        const dKey = `D_${timeWindow}_${baseDestKey}`;
        upsertPattern(patternMap, dKey, {
            score: 0.8, type: 'daily',
            reservation: r, timeWindow, vehicleId: r.vehicleId, duration: validDuration,
        });

        // 목적지가 있는 경우에만 복합 패턴 추가
        if (dest) {
            // 3. Dest-Weekly
            const dwKey = `DW_${weekday}_${dest}`;
            upsertPattern(patternMap, dwKey, {
                score: 0.9, type: 'dest-weekly', targetWeekday: weekday,
                reservation: r, timeWindow, vehicleId: r.vehicleId, duration: validDuration,
            });

            // 4. Dest-Daily
            const ddKey = `DD_${dest}`;
            upsertPattern(patternMap, ddKey, {
                score: 0.6, type: 'dest-daily',
                reservation: r, timeWindow, vehicleId: r.vehicleId, duration: validDuration,
            });
        }
    }

    return patternMap;
}

function upsertPattern(
    map: Map<string, PatternResult>,
    key: string,
    params: {
        score: number;
        type: PatternResult['type'];
        targetWeekday?: number;
        reservation: ReservationInput;
        timeWindow: string;
        vehicleId: string;
        duration: number;
    },
) {
    const existing = map.get(key);
    if (existing) {
        existing.count += 1;
        existing.score += params.score;
        existing.vehicles.push(params.vehicleId);
        existing.durations.push(params.duration);
        if (!existing.times.includes(params.timeWindow)) existing.times.push(params.timeWindow);
    } else {
        map.set(key, {
            score: params.score,
            count: 1,
            type: params.type,
            targetWeekday: params.targetWeekday,
            reservation: params.reservation,
            times: [params.timeWindow],
            vehicles: [params.vehicleId],
            durations: [params.duration],
        });
    }
}

/** 동적 threshold 적용 후 상위 N개 패턴 추출 */
export function selectTopPatterns(
    patternMap: Map<string, PatternResult>,
    totalCount: number,
    topN = 2,
): PatternResult[] {
    const dynamicThreshold = totalCount <= 15 ? 2 : 3;
    return Array.from(patternMap.values())
        .filter(item => item.count >= dynamicThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
}

// ─── 추천 결과 생성 (순수 계산 부분) ────────────────────

/** 시간 배열에서 최빈 시간을 반환 */
export function getMostFrequentTime(times: string[], fallback: string): string {
    if (times.length === 0) return fallback;
    const timeCounts = new Map<string, number>();
    let maxCount = 0;
    let maxTimeStr = fallback;

    times.forEach(t => {
        const tc = (timeCounts.get(t) || 0) + 1;
        timeCounts.set(t, tc);
        if (tc > maxCount) {
            maxCount = tc;
            maxTimeStr = t;
        }
    });
    return maxTimeStr;
}

/** 평균 소요시간(분) 계산 */
export function calcAverageDuration(durations: number[]): number {
    return durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 60;
}

/** 차량 배열에서 최빈 차량 ID 반환 */
export function getMostFrequentVehicle(vehicles: string[]): string {
    if (vehicles.length === 0) return '';
    const pvCount = new Map<string, number>();
    let maxVC = 0;
    let result = '';

    vehicles.forEach(v => {
        const c = (pvCount.get(v) || 0) + 1;
        pvCount.set(v, c);
        if (c > maxVC) {
            maxVC = c;
            result = v;
        }
    });
    return result;
}
