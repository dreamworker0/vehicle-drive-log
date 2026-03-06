/**
 * timelineUtils — VehicleTimelineBar에서 사용하는 유틸리티 함수
 */

// 표시 범위: 06:00 ~ 23:00 (17시간)
export const TIMELINE_START = 6;
export const TIMELINE_END = 23;
export const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;

// 30분 단위 스냅
export const SNAP_MINUTES = 30;

// 타임라인 범위(분 단위)
export const RANGE_START = TIMELINE_START * 60;
export const RANGE_END = TIMELINE_END * 60;
export const TOTAL_MINUTES = RANGE_END - RANGE_START;

/**
 * 시간 문자열("HH:MM")을 분 단위 숫자로 변환
 * @param {string} t - "HH:MM" 형식
 * @returns {number} 분 단위 값
 */
export const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

/**
 * 분 단위를 "HH:MM" 문자열로 변환
 * @param {number} mins - 분 단위 값
 * @returns {string} "HH:MM" 형식
 */
export const minutesToTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * 분 단위 값을 SNAP_MINUTES 간격으로 스냅
 * @param {number} mins - 원본 분 값
 * @returns {number} 스냅된 분 값
 */
export const snapMinutes = (mins: number) => Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES;

/**
 * 분 단위 시각을 타임라인 퍼센트로 변환
 * @param {number} minutes - 분 단위 시각
 * @returns {number} 0~100 퍼센트
 */
export const getPercent = (minutes: number) => {
    const clamped = Math.max(RANGE_START, Math.min(RANGE_END, minutes));
    return ((clamped - RANGE_START) / TOTAL_MINUTES) * 100;
};

/**
 * 빈 시간 슬롯(gap) 계산
 * @param {Array} vReservations - 해당 차량의 예약 배열 (startTime, endTime 포함)
 * @param {boolean} isToday - 오늘 여부
 * @param {number} nowSnapped - 현재 시각(스냅된 분 값)
 * @returns {Array<{start: number, end: number}>} 빈 시간 슬롯 배열
 */
export const getGaps = (vReservations: Record<string, any>[], isToday: boolean, nowSnapped: number) => {
    const gaps: { start: number; end: number }[] = [];
    const effectiveStart = isToday ? Math.max(RANGE_START, nowSnapped) : RANGE_START;
    let cursor = effectiveStart;

    for (const r of vReservations) {
        const rStart = Math.max(effectiveStart, timeToMinutes(r.startTime));
        const rEnd = Math.min(RANGE_END, timeToMinutes(r.endTime));
        if (rEnd <= effectiveStart) continue;
        if (rStart > cursor) {
            gaps.push({ start: cursor, end: rStart });
        }
        cursor = Math.max(cursor, rEnd);
    }
    if (cursor < RANGE_END) {
        gaps.push({ start: cursor, end: RANGE_END });
    }
    return gaps;
};

/**
 * 시간 눈금 라벨 배열 생성 (3시간 간격)
 * @returns {number[]} 시간 배열
 */
export const getHourLabels = () => {
    const labels: number[] = [];
    for (let h = TIMELINE_START; h <= TIMELINE_END; h += 3) {
        labels.push(h);
    }
    return labels;
};
