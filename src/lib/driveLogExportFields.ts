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

/** 주유 조인에 필요한 운행일지 최소 형태 (조인 결과를 기록할 fuelSummary 포함) */
interface FuelJoinableDriveLog extends ExportableDriveLog {
    vehicleId?: string;
    fuelSummary?: string;
}

/** 조인에 필요한 주유 기록 최소 형태 (getFuelLogs가 반환하는 느슨한 문서를 그대로 수용) */
interface FuelJoinRecord {
    vehicleId?: string;
    date?: string;
    fuelType?: string;
    fuelAmount?: number;
    fuelCost?: number;
    [key: string]: unknown;
}

/** 연료 유형에 따른 단위 (충전은 kWh/kg, 주유는 L). downloadFuelLogsExcel과 동일 규칙. */
function fuelUnit(fuelType?: string): string {
    if (fuelType === 'hydrogen') return 'kg';
    if (fuelType === 'electric') return 'kWh';
    return 'L';
}

/**
 * 주유 기록을 운행일지에 조인해 `fuelSummary`(주유금액(주유량))를 부착한다.
 *
 * - 주유 기록은 별도 컬렉션이라 `차량ID + 날짜`로 매칭되며 1:N이다.
 * - 같은 차량·날짜의 주유금액·주유량을 합산한 뒤, 그날 첫 운행(출발 시각 오름차순) 행에만
 *   부착한다. 나머지 행은 비워 열 합계 시 중복 계산을 막는다.
 * - 내보내기용 로컬 객체를 그대로 변형(mutate)하며, 편의상 같은 배열을 반환한다.
 */
export function attachFuelSummary<T extends FuelJoinableDriveLog>(
    logs: T[],
    fuelLogs: FuelJoinRecord[],
): T[] {
    if (!fuelLogs || fuelLogs.length === 0) return logs;

    // 1) 차량+날짜별 주유 합산
    const fuelByKey = new Map<string, { cost: number; amount: number; fuelType?: string }>();
    for (const f of fuelLogs) {
        if (!f.vehicleId || !f.date) continue;
        const key = `${f.vehicleId}__${f.date}`;
        const acc = fuelByKey.get(key) ?? { cost: 0, amount: 0, fuelType: f.fuelType };
        acc.cost += f.fuelCost || 0;
        acc.amount += f.fuelAmount || 0;
        fuelByKey.set(key, acc);
    }
    if (fuelByKey.size === 0) return logs;

    // 2) 운행일지를 차량+날짜로 그룹핑
    const logsByKey = new Map<string, T[]>();
    for (const log of logs) {
        if (!log.vehicleId) continue;
        const key = `${log.vehicleId}__${resolveDateStr(log)}`;
        if (!fuelByKey.has(key)) continue; // 주유 없는 그룹은 건너뜀
        const arr = logsByKey.get(key);
        if (arr) arr.push(log);
        else logsByKey.set(key, [log]);
    }

    // 3) 각 그룹의 첫 운행(출발 시각 오름차순) 행에만 요약 부착
    for (const [key, groupLogs] of logsByKey) {
        const { cost, amount, fuelType } = fuelByKey.get(key)!;
        const first = groupLogs.reduce((a, b) =>
            resolveStartTime(a).localeCompare(resolveStartTime(b)) <= 0 ? a : b,
        );
        first.fuelSummary = `${cost.toLocaleString()}(${amount.toLocaleString()}${fuelUnit(fuelType)})`;
    }

    return logs;
}
