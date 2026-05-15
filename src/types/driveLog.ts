/**
 * 운행일지 (Drive Logs) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface DriveLog extends FirestoreDoc {
    [key: string]: unknown;
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    vehicleDisplayName?: string;
    driverUid: string;
    driverName?: string;
    date?: string;
    timestamp: Date | TimestampField;
    startKm: number;
    endKm: number;
    distance?: number;
    startTime?: string;
    endTime?: string;
    purpose?: string;
    destination?: string;
    startLocation?: string;
    passengers?: number;
    vehicleType?: string;
    passengerCount?: number;
    passengerNames?: string[];
    notes?: string;
    fuelAmount?: number;
    energyCost?: number;
    batteryStart?: number;
    batteryEnd?: number;
    isRetroactive?: boolean;
    isIncomplete?: boolean;
    reservationId?: string;
    inputMethod?: 'ocr' | 'manual' | 'favorite';
    createdAt?: TimestampField;
    editedAt?: TimestampField;
    expiresAt?: Date | TimestampField;
}

/** createDriveLog에 전달할 데이터 */
export type CreateDriveLogData = Omit<DriveLog, 'id' | 'createdAt' | 'editedAt'>;

/**
 * 관리자 목록·테이블에서 다루는 운행일지 UI 뷰 타입.
 * Firestore 결과를 그대로 렌더에 쓰기 때문에 timestamp는 toDate()를 갖는 Firestore Timestamp 형태.
 * 정식 DriveLog는 timestamp가 Date | TimestampField 라서 별도 분리.
 */
export interface DriveLogEntry {
    id: string;
    vehicleId?: string;
    vehicleName?: string;
    driverUid?: string;
    driverName?: string;
    date?: string;
    startKm: number;
    endKm: number;
    startTime?: string;
    endTime?: string;
    destination?: string;
    purpose?: string;
    passengerCount?: number;
    timestamp?: { toDate: () => Date };
    [key: string]: unknown;
}

/** DriveLog 페이지네이션 결과 */
export interface DriveLogPage {
    docs: DriveLog[];
    lastDoc: unknown;  // Firestore DocumentSnapshot
    hasMore: boolean;
}

/** syncNextLogStartKm 결과 */
export interface SyncResult {
    updated: boolean;
    logId?: string;
    oldStartKm?: number;
    newStartKm?: number;
}

/** getDriveLogs 필터 옵션 */
export interface DriveLogFilters {
    limit?: number;
    startAfter?: unknown;  // Firestore DocumentSnapshot
}

/** 오프라인 동기화 큐페이로드 타입 검증 가드 (Create) */
export function isCreateDriveLogPayload(payload: unknown): payload is Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    // 최소한의 필수 속성 타입 체크
    return typeof p.organizationId === 'string' 
        && typeof p.vehicleId === 'string'
        && typeof p.driverUid === 'string'
        && typeof p.startKm === 'number'
        && typeof p.endKm === 'number';
}

/** 오프라인 동기화 큐페이로드 타입 검증 가드 (Update) */
export function isUpdateDriveLogPayload(payload: unknown): payload is Record<string, unknown> & { id: string } {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.id === 'string';
}
