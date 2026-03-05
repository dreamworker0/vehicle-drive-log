/**
 * dateUtils — 로컬 타임존 기준 날짜 유틸리티
 * toISOString()은 UTC 기준이라 KST(UTC+9) 환경에서 자정~오전 9시 사이에
 * 전날 날짜가 반환되는 문제를 방지하기 위해 로컬 시간 기반 함수를 제공합니다.
 */

/**
 * 로컬 타임존 기준 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환
 * @param {Date} [date] - 기준 날짜 (기본: 현재 시각)
 * @returns {string} 'YYYY-MM-DD'
 */
export function toLocalDateStr(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 로컬 타임존 기준 'YYYY-MM' 형식 반환
 * @param {Date} [date] - 기준 날짜 (기본: 현재 시각)
 * @returns {string} 'YYYY-MM'
 */
export function toLocalMonthStr(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * Firestore Timestamp → 'M월 D일 (요일)' 형식
 * VehicleHistory, MyRecords 등에서 사용
 */
export function formatTimestamp(ts) {
    if (!ts?.toDate) return '-';
    const d = ts.toDate();
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
}

/**
 * Firestore Timestamp → 'M/D(요일)' 축약 형식
 * MyRecords 등 공간이 제한된 리스트에서 사용
 */
export function formatTimestampShort(ts) {
    if (!ts?.toDate) return '-';
    const d = ts.toDate();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${m}/${day}(${weekday})`;
}

/**
 * Firestore Timestamp → 'HH:MM' 형식
 * VehicleHistory, MyRecords 등에서 사용
 */
export function formatTimestampTime(ts) {
    if (!ts?.toDate) return '';
    return ts.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Firestore Timestamp 또는 Date → 'YYYY.MM.DD HH:MM' 형식
 * OrgCard, FeedbackManagement 등에서 사용
 */
export function formatTimestampFull(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

/**
 * 'YYYY-MM-DD' 문자열 → 'M월 D일 (요일)' 형식
 * useSettings의 공휴일 날짜 표시에 사용
 */
export function formatDateKr(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
}
