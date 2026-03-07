/**
 * 예약 관련 유틸리티 — 순수 함수로 단위 테스트 가능
 */

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
 * @param {Array} reservations - 기존 예약 목록
 * @param {Object} params - { vehicleId, date, startTime, endTime, excludeId? }
 * @returns {Object|null} 중복 예약이 있으면 해당 예약 반환, 없으면 null
 */
export function findOverlappingReservation(reservations: Record<string, any>[], { vehicleId, date, startTime, endTime, excludeId = null }: { vehicleId: string; date: string; startTime: string; endTime: string; excludeId?: string | null }) {
    return reservations.find((r: Record<string, any>) =>
        r.vehicleId === vehicleId &&
        r.date === date &&
        r.status !== 'cancelled' &&
        r.status !== 'completed' &&
        (!excludeId || r.id !== excludeId) &&
        startTime < r.endTime && endTime > r.startTime
    ) || null;
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
