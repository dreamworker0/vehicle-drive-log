/**
 * 데이터 집계(Aggregation) 및 공통 유틸리티
 * 여러 통계/분석 파일에서 공통으로 사용되는 날짜 추출 및 기초 수학/필터링 함수들을 정의합니다.
 */

export interface BaseLog {
    date?: string;
    timestamp?: unknown;
    [key: string]: unknown;
}

/**
 * 로그 데이터에서 안전하게 날짜 문자열(YYYY-MM-DD) 추출
 * date 필드가 있으면 우선 사용, 없으면 timestamp 필드 지원 (Firebase Timestamp 객체 또는 Date)
 */
export function extractDateStr(log: BaseLog): string {
    if (log.date) return log.date;
    const ts = log.timestamp;
    if (!ts) return '';
    const d = ts instanceof Date ? ts : ts.toDate?.();
    return d?.toISOString?.()?.slice(0, 10) || '';
}

/**
 * 전 기간 대비 현재 기간의 변화율(%) 계산
 */
export function calcChangeRate(cur: number, prev: number): number {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
}

/**
 * Date 객체를 YYYY-MM 형식으로 변환
 */
export function formatMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * 최근 N개월의 YYYY-MM 키 목록 생성 (과거순 -> 현재순 정렬)
 */
export function getRecentMonthKeys(monthCount = 6): string[] {
    const keys: string[] = [];
    const now = new Date();
    for (let i = monthCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        keys.push(formatMonth(d));
    }
    return keys;
}

/**
 * 특정 시작/종료 날짜 사이에 있는 로그만 안전하게 필터링
 */
export function filterLogsByDateRange<T extends BaseLog>(logs: T[], startDate: string, endDate: string): T[] {
    return logs.filter(l => {
        const d = extractDateStr(l);
        if (!d) return false;
        return d >= startDate && d <= endDate;
    });
}
