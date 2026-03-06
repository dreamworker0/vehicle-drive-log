/**
 * 운행일지 (Drive Logs) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface DriveLog extends FirestoreDoc {
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
    notes?: string;
    fuelAmount?: number;
    energyCost?: number;
    batteryStart?: number;
    batteryEnd?: number;
    isRetroactive?: boolean;
    isIncomplete?: boolean;
    reservationId?: string;
    createdAt?: TimestampField;
    editedAt?: TimestampField;
}

/** createDriveLog에 전달할 데이터 */
export type CreateDriveLogData = Omit<DriveLog, 'id' | 'createdAt' | 'editedAt'>;

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
