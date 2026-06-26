/**
 * 운행일지 내보내기(Excel/PDF) 공용 필드 해석 헬퍼.
 *
 * 운행일지 문서는 구·신 필드명이 혼재한다(예: startKm/departureKm, endKm/arrivalKm,
 * startTime/departureTime). Excel·PDF 내보내기가 동일한 별칭 해석을 각자 중복 구현하고
 * 있어, 같은 거리 계산식이 네 곳에 흩어져 있었다. 단일 원본으로 모아 정렬·표시·합계가
 * 항상 동일한 규칙을 따르도록 한다.
 */
import { toLocalDateStr } from './dateUtils';

/** Excel/PDF 내보내기에서 공통으로 읽는 운행일지 필드의 최소 형태 */
export interface ExportableDriveLog {
    date?: string;
    timestamp?: { toDate?: () => Date };
    startTime?: string;
    endTime?: string;
    departureTime?: string;
    arrivalTime?: string;
    departureKm?: number;
    arrivalKm?: number;
    startKm?: number;
    endKm?: number;
}

/** 출발 Km (departureKm 우선, 없으면 startKm). 0은 보존하고 둘 다 없으면 undefined. */
export function resolveStartKm(log: ExportableDriveLog): number | undefined {
    return log.departureKm ?? log.startKm;
}

/** 도착 Km (arrivalKm 우선, 없으면 endKm). 0은 보존하고 둘 다 없으면 undefined. */
export function resolveEndKm(log: ExportableDriveLog): number | undefined {
    return log.arrivalKm ?? log.endKm;
}

/** 주행거리. 도착-출발이 양수일 때만 그 값을, 그 외에는 0을 반환한다. */
export function resolveDistance(log: ExportableDriveLog): number {
    const dist = (log.arrivalKm || log.endKm || 0) - (log.departureKm || log.startKm || 0);
    return dist > 0 ? dist : 0;
}

/** 날짜 문자열 (date 우선, 없으면 timestamp를 로컬 날짜로 변환). 둘 다 없으면 fallback. */
export function resolveDateStr(log: ExportableDriveLog, fallback = ''): string {
    return log.date || (log.timestamp?.toDate ? toLocalDateStr(log.timestamp.toDate()) : fallback);
}

/** 출발 시각 (startTime 우선, 없으면 departureTime). */
export function resolveStartTime(log: ExportableDriveLog): string {
    return log.startTime || log.departureTime || '';
}

/** 도착 시각 (endTime 우선, 없으면 arrivalTime). */
export function resolveEndTime(log: ExportableDriveLog): string {
    return log.endTime || log.arrivalTime || '';
}
