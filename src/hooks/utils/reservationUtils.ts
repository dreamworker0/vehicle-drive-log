/**
 * 예약 관련 유틸리티 — 순수 함수로 단위 테스트 가능
 */
import { eachDayOfInterval, format } from 'date-fns';
import type { Reservation } from '../../types/reservation';

/**
 * 현재 시간을 HH:MM 포맷으로 반환
 */
export const getCurrentTimeStr = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

/**
 * 현재 시각 기준 다음 30분 단위 시간을 반환
 * 예: 14:05 → 14:30, 14:40 → 15:00
 */
export const getNextRoundedTime = () => {
    const n = new Date();
    const mins = n.getMinutes();
    if (mins === 0) return `${String(n.getHours()).padStart(2, '0')}:00`;
    if (mins <= 30) return `${String(n.getHours()).padStart(2, '0')}:30`;
    const nextHour = n.getHours() + 1;
    if (nextHour >= 24) return '23:30';
    return `${String(nextHour).padStart(2, '0')}:00`;
};

/**
 * 오늘의 날짜 문자열을 반환 (YYYY-MM-DD)
 */
export const getTodayStr = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * 시작 시간의 최소값을 반환 (오늘이면 현재 시각, 그 외 00:00)
 * @param {boolean} isToday
 * @returns {string}
 */
export const getMinStartTime = (isToday: boolean) => isToday ? getCurrentTimeStr() : '00:00';

/**
 * 예약 시간 중복 여부를 검사한다.
 *
 * 그룹(다일·반복) 수정은 기존 그룹을 지우고 다시 만드는 방식이라, 수정 중인 그룹 자신을
 * 제외하지 않으면 **자기 예약과 겹친다는 이유로 시간을 바꿀 수 없다.** 단건 `excludeId`만으로는
 * 그룹의 나머지 날짜가 그대로 남아 걸리므로 그룹 단위 제외를 함께 받는다.
 *
 * @param {Array} reservations - 기존 예약 목록
 * @param {Object} params - { vehicleId, date, startTime, endTime, excludeId?, excludeGroupId?, excludeRecurringGroupId? }
 * @returns {Object|null} 중복 예약이 있으면 해당 예약 반환, 없으면 null
 */
interface OverlapExclusions {
    excludeId?: string | null;
    excludeGroupId?: string | null;
    excludeRecurringGroupId?: string | null;
}

/** 수정 중인 예약·그룹은 자기 자신과 충돌할 수 없다 (차량 검사와 사람 검사가 같은 규칙을 쓴다) */
function isExcluded(r: Reservation, { excludeId, excludeGroupId, excludeRecurringGroupId }: OverlapExclusions) {
    if (excludeId && r.id === excludeId) return true;
    if (excludeGroupId && r.groupId === excludeGroupId) return true;
    if (excludeRecurringGroupId && r.recurringGroupId === excludeRecurringGroupId) return true;
    return false;
}

/** 예약이 실제로 시간을 점유하는 구간 — 운행을 마쳤으면 실제 운행 시간이 기준이다 */
function effectiveRange(r: Reservation) {
    return {
        start: (r.status === 'completed' && r.actualStartTime) ? r.actualStartTime : r.startTime,
        end: (r.status === 'completed' && r.actualEndTime) ? r.actualEndTime : r.endTime,
    };
}

export function findOverlappingReservation(
    reservations: Reservation[],
    { vehicleId, date, startTime, endTime, ...exclusions }: {
        vehicleId: string;
        date: string;
        startTime: string;
        endTime: string;
    } & OverlapExclusions,
) {
    return reservations.find((r) => {
        if (r.vehicleId !== vehicleId || r.date !== date || r.status === 'cancelled') return false;
        if (isExcluded(r, exclusions)) return false;

        const { start: effStart, end: effEnd } = effectiveRange(r);

        return startTime < effEnd && endTime > effStart;
    }) || null;
}

/**
 * 한 사람이 같은 시간대에 이미 잡아 둔 예약을 찾는다 (차량이 달라도 충돌이다).
 *
 * **한 사람은 같은 시간에 차량 한 대만 예약한다.** 한 사람이 두 대를 동시에 몰 수 없고,
 * 여러 대를 잡아 두면 정작 필요한 사람이 예약하지 못한다. 여러 대가 필요한 행사라면
 * 실제로 운전할 사람 명의로 각각 잡아야 한다.
 *
 * 제외 규칙(수정 중인 예약·그룹)은 차량 겹침 검사와 같다 — 그래서 차량 검사를 통과한
 * 건이 사람 검사에서 자기 그룹 때문에 걸리는 일이 없다.
 */
export function findOwnerOverlappingReservation(
    reservations: Reservation[],
    { reservedByUid, date, startTime, endTime, ...exclusions }: {
        reservedByUid: string;
        date: string;
        startTime: string;
        endTime: string;
    } & OverlapExclusions,
) {
    if (!reservedByUid) return null;

    return reservations.find((r) => {
        if (r.reservedByUid !== reservedByUid || r.date !== date || r.status === 'cancelled') return false;
        if (isExcluded(r, exclusions)) return false;

        const { start: effStart, end: effEnd } = effectiveRange(r);

        return startTime < effEnd && endTime > effStart;
    }) || null;
}

/**
 * 다일(연속) 예약이 만들 날짜별 시간 구간을 계산한다.
 *
 * 첫날은 시작 시간부터 자정 직전까지, 중간 날은 하루 전체, 마지막 날은 자정부터 종료 시간까지 —
 * 연속 운행이라 중간에 차가 반납되지 않는다는 뜻이다. 검증(충돌 검사)과 실제 생성이
 * **같은 목록**을 봐야 하므로 한 곳에서 만든다.
 *
 * @param startDate 시작일 (YYYY-MM-DD)
 * @param endDate 종료일 (YYYY-MM-DD). 시작일 이하면 하루짜리 1건으로 본다.
 */
export function buildMultiDaySlots(startDate: string, endDate: string, startTime: string, endTime: string) {
    if (!endDate || endDate <= startDate) return [{ date: startDate, startTime, endTime }];

    const days = eachDayOfInterval({
        start: new Date(startDate + 'T00:00'),
        end: new Date(endDate + 'T00:00'),
    });
    const lastIndex = days.length - 1;
    return days.map((day, i) => ({
        date: format(day, 'yyyy-MM-dd'),
        startTime: i === 0 ? startTime : '00:00',
        endTime: i === lastIndex ? endTime : '23:59',
    }));
}

/**
 * 시작시간 + 왕복 소요시간 + 여유 1시간으로 종료시간 계산
 * @param {string} startTime - HH:MM 형식
 * @param {number} durationMin - 편도 소요시간(분), 없으면 0
 * @returns {string} HH:MM 형식의 종료시간 (23:59 캡핑)
 */
export function calcEndTime(startTime: string, durationMin = 0) {
    const [h, m] = startTime.split(':').map(Number);
    const addMin = (durationMin * 2) + 60;
    // 10분 단위 올림
    const roundedAdd = Math.ceil(addMin / 10) * 10;
    const totalMin = h * 60 + m + roundedAdd;
    const cappedMin = Math.min(totalMin, 23 * 60 + 59);
    return `${String(Math.floor(cappedMin / 60)).padStart(2, '0')}:${String(cappedMin % 60).padStart(2, '0')}`;
}

/**
 * 오늘 날짜 기준 시작/종료 시간 자동 계산
 * @param {string} selectedDate
 * @param {number} durationMin - 편도 소요시간(분), 없으면 0
 * @returns {{ startTime: string, endTime: string }}
 */
export function getAutoTimes(selectedDate: string, durationMin = 0) {
    const todayStrValue = getTodayStr();
    if (selectedDate === todayStrValue) {
        const roundedStart = getNextRoundedTime();
        return { startTime: roundedStart, endTime: calcEndTime(roundedStart, durationMin) };
    }
    return { startTime: '09:00', endTime: calcEndTime('09:00', durationMin) };
}

/**
 * 시간을 30분 단위로 올림 스냅한다.
 * 예: (14, 5) → { h: 14, m: 30 }, (14, 40) → { h: 15, m: 0 }
 */
export const snapTo30 = (h: number, m: number): { h: number; m: number } => {
    if (m <= 0) return { h, m: 0 };
    if (m <= 30) return { h, m: 30 };
    return { h: h + 1, m: 0 };
};

