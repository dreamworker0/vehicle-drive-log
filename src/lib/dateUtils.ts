/**
 * dateUtils — 로컬 타임존 기준 날짜 유틸리티
 * toISOString()은 UTC 기준이라 KST(UTC+9) 환경에서 자정~오전 9시 사이에
 * 전날 날짜가 반환되는 문제를 방지하기 위해 로컬 시간 기반 함수를 제공합니다.
 */

/** Firestore Timestamp 호환 타입 */
type TimestampLike = { toDate: () => Date } | { seconds: number } | Date | string | number | null | undefined | unknown;

/**
 * 로컬 타임존 기준 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환
 * @param {Date} [date] - 기준 날짜 (기본: 현재 시각)
 * @returns {string} 'YYYY-MM-DD'
 */
export function toLocalDateStr(date?: Date) {
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
export function toLocalMonthStr(date?: Date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * Firestore Timestamp → 'M월 D일 (요일)' 형식
 * VehicleHistory, MyRecords 등에서 사용
 */
export function formatTimestamp(ts: TimestampLike) {
    if (!ts || typeof ts !== 'object' || !('toDate' in ts) || typeof ts.toDate !== 'function') return '-';
    const d = ts.toDate();
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
}

/**
 * Firestore Timestamp → 'M/D(요일)' 축약 형식
 * MyRecords 등 공간이 제한된 리스트에서 사용
 */
export function formatTimestampShort(ts: TimestampLike) {
    if (!ts || typeof ts !== 'object' || !('toDate' in ts) || typeof ts.toDate !== 'function') return '-';
    const d = ts.toDate();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${m}/${day}(${weekday})`;
}

/**
 * Firestore Timestamp 또는 Date → 시각 문자열
 * 기본은 로케일 기본 표기('PM 02:05'), { hour12: false }면 24시간 표기('14:05').
 * VehicleHistory, MyRecords(기본) / 주유·하이패스 관리, 엑셀 내보내기(24시간)에서 사용
 */
export function formatTimestampTime(ts: TimestampLike, opts?: { hour12?: boolean }) {
    let d: Date | null = null;
    if (ts instanceof Date) {
        d = ts;
    } else if (ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
        d = ts.toDate();
    }
    if (!d) return '';
    return d.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        // 기존 호출부(옵션 미지정) 표기를 바꾸지 않도록 명시된 경우에만 hour12 전달
        ...(opts?.hour12 !== undefined ? { hour12: opts.hour12 } : {}),
    });
}

/**
 * Firestore Timestamp 또는 Date → 'YYYY.MM.DD HH:MM' 형식
 * OrgCard, FeedbackManagement 등에서 사용
 */
export function formatTimestampFull(ts: TimestampLike) {
    if (!ts) return null;
    const d = (typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') ? ts.toDate() : new Date(ts as string | number);
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
export function formatDateKr(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
}
