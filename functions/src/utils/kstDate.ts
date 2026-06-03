/**
 * Cloud Functions (UTC 환경)에서 KST(Asia/Seoul, UTC+9) 기준 날짜를 다루기 위한 유틸.
 * Cloud Functions의 Node.js 런타임은 UTC 기준이므로,
 * new Date().getFullYear()/getMonth()/getDate() 등은 UTC 기준입니다.
 * 이 유틸은 UTC Date 객체를 KST 기준으로 변환합니다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC Date 객체를 KST 오프셋이 적용된 Date 객체로 변환 */
export function toKSTDate(date: Date = new Date()): Date {
    return new Date(date.getTime() + (date.getTimezoneOffset() * 60000) + KST_OFFSET_MS);
}

/** Date → KST 기준 'YYYY-MM-DD' 문자열 */
export function getKSTDateString(date: Date = new Date()): string {
    const kst = toKSTDate(date);
    return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}-${String(kst.getDate()).padStart(2, "0")}`;
}

/** Date → KST 기준 연도 */
export function getKSTYear(date: Date = new Date()): number {
    return toKSTDate(date).getFullYear();
}

/** Date → KST 기준 월 (0-indexed) */
export function getKSTMonth(date: Date = new Date()): number {
    return toKSTDate(date).getMonth();
}

/** Date → KST 기준 일 */
export function getKSTDay(date: Date = new Date()): number {
    return toKSTDate(date).getDate();
}

/** Date → KST 기준 요일 (0=일, 1=월, ..., 6=토) */
export function getKSTDayOfWeek(date: Date = new Date()): number {
    return toKSTDate(date).getDay();
}

/** Date → KST 기준 시(hour, 0-23) */
export function getKSTHour(date: Date = new Date()): number {
    return toKSTDate(date).getHours();
}

/** KST 기준 'YYYY-MM' 월 키 */
export function getKSTMonthKey(date: Date = new Date()): string {
    const kst = toKSTDate(date);
    return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}`;
}
