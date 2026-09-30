/**
 * 데이터 집계(Aggregation) 및 공통 유틸리티
 * 여러 통계/분석 파일에서 공통으로 사용되는 날짜 추출 및 기초 수학/필터링 함수들을 정의합니다.
 */
import { toLocalDateStr } from '../../lib/dateUtils';

export interface BaseLog {
    date?: string;
    timestamp?: unknown;
}

/**
 * 로그 데이터에서 안전하게 날짜 문자열(YYYY-MM-DD) 추출
 * date 필드가 있으면 우선 사용, 없으면 timestamp 필드 지원 (Firebase Timestamp 객체 또는 Date)
 */
export function extractDateStr(log: BaseLog): string {
    if (log.date) return log.date;
    const ts = log.timestamp;
    if (!ts) return '';
    
    let d: Date | undefined;
    if (ts instanceof Date) {
        d = ts;
    } else if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
        const toDateFunc = (ts as Record<string, unknown>).toDate;
        if (typeof toDateFunc === 'function') {
            d = (ts as { toDate: () => Date }).toDate();
        }
    }
    
    return d ? toLocalDateStr(d) : '';
}

/**
 * 운행 한 건의 주행거리(km) — 두 화면(통계·분석)과 엑셀이 같은 규칙을 쓴다.
 *
 * 저장된 distance를 먼저 쓰고(다일 운행·정정 기록은 이 값이 정본이다), 없으면 도착−출발.
 * 음수는 0으로 센다 — 계기판 역전 기록이 합계를 깎지 않게 한다(야간 집계 dailyAggregation과 같다).
 */
export function logDistance(log: { distance?: number | null; startKm?: number | null; endKm?: number | null }): number {
    const raw = typeof log.distance === 'number' ? log.distance : (log.endKm || 0) - (log.startKm || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
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
