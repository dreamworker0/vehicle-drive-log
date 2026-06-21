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
 * @param {number} [dynamicStart] - 동적 시작점(분). 오늘 모드에서 현재 시각 기준으로 사용
 * @returns {number} 0~100 퍼센트
 */
export const getPercent = (minutes: number, dynamicStart?: number) => {
    const start = dynamicStart ?? RANGE_START;
    const total = RANGE_END - start;
    const clamped = Math.max(start, Math.min(RANGE_END, minutes));
    return total > 0 ? ((clamped - start) / total) * 100 : 0;
};

/**
 * 빈 시간 슬롯(gap) 계산
 * @param {Array} vReservations - 해당 차량의 예약 배열 (startTime, endTime 포함)
 * @param {boolean} isToday - 오늘 여부
 * @param {number} nowSnapped - 현재 시각(스냅된 분 값)
 * @returns {Array<{start: number, end: number}>} 빈 시간 슬롯 배열
 */
interface TimelineReservation {
    startTime: string;
    endTime: string;
}

export const getGaps = (vReservations: TimelineReservation[], isToday: boolean, nowSnapped: number) => {
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
 * 예약 1건의 타임라인 블록 위치(left/width %)를 계산하는 순수 함수.
 *
 * - completed 상태에서 actualTime이 예약 시간과 2시간 이상 벗어나면 잘못된 완료
 *   처리로 보고 원래 예약 시간을 폴백으로 사용한다.
 * - 시야 범위(dynamicStart) 밖이거나 1.5% 미만으로 짧은 예약도 사용자가
 *   인식/클릭할 수 있도록 최소 1.5% 폭을 보장한다.
 *
 * @param r - 예약(시간 필드만 사용)
 * @param dynamicStart - 동적 시작점(분)
 * @returns {{ left: number; width: number }} 0~100 퍼센트 좌표
 */
export interface ReservationBlockInput {
    status?: string;
    startTime?: string;
    endTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
}

export const resolveReservationBlock = (
    r: ReservationBlockInput,
    dynamicStart: number,
): { left: number; width: number } => {
    const isCompleted = r.status === 'completed';

    // completed 상태에서 actualTime이 예약 시간과 2시간 이상 벗어나면
    // 잘못된 완료 처리로 판단하여 원래 예약 시간을 폴백으로 사용
    const isActualValid = (actual: string | undefined, scheduled: string) => {
        if (!actual) return false;
        return Math.abs(timeToMinutes(actual) - timeToMinutes(scheduled)) <= 120;
    };

    const effStart = (isCompleted && isActualValid(r.actualStartTime, r.startTime || ''))
        ? r.actualStartTime! : (r.startTime || '');
    const effEnd = (isCompleted && isActualValid(r.actualEndTime, r.endTime || ''))
        ? r.actualEndTime! : (r.endTime || '');
    const rStartMin = timeToMinutes(effStart);
    const rEndMin = timeToMinutes(effEnd);

    const clampedStartMin = Math.max(rStartMin, dynamicStart);
    const clampedEndMin = Math.max(rEndMin, dynamicStart);

    let left = getPercent(clampedStartMin, dynamicStart);
    let right = getPercent(clampedEndMin, dynamicStart);

    if (left > right) {
        const temp = left; left = right; right = temp;
    }

    if (Number.isNaN(left)) left = 0;
    if (Number.isNaN(right)) right = left + 1.5;

    let width = right - left;

    // 1% 미만의 아주 짧은 예약이거나 시야범위 밖 예약이더라도
    // 사용자가 시각적으로 최소한의 블록을 클릭/인식할 수 있게 1.5% 보장
    if (width < 1.5 || Number.isNaN(width)) {
        width = 1.5;
        if (left + width > 100) left = 100 - width;
    }

    return { left, width };
};

/**
 * 시간 눈금 라벨 배열 생성 (3시간 간격)
 * @param {number} [dynamicStartHour] - 동적 시작 시간(시). 생략 시 TIMELINE_START 사용
 * @returns {number[]} 시간 배열
 */
export const getHourLabels = (dynamicStartHour?: number) => {
    const startHour = dynamicStartHour ?? TIMELINE_START;
    const labels: number[] = [];
    // 시작 시간을 3시간 간격으로 올림
    const firstLabel = Math.ceil(startHour / 3) * 3;
    for (let h = firstLabel; h <= TIMELINE_END; h += 3) {
        labels.push(h);
    }
    return labels;
};
