/**
 * 운행일지 (Drive Logs) 타입
 *
 * 문서 모양의 원본은 `src/schemas/driveLog.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { driveLogSchema } from '../schemas/driveLog';
import type { FirestoreDoc } from './common';

export type DriveLog = z.infer<typeof driveLogSchema> & FirestoreDoc;

/** createDriveLog에 전달할 데이터 */
export type CreateDriveLogData = Omit<DriveLog, 'id' | 'createdAt' | 'editedAt'>;

/** DriveLog 페이지네이션 결과 */
export interface DriveLogPage {
    docs: DriveLog[];
    lastDoc: unknown;  // Firestore DocumentSnapshot
    hasMore: boolean;
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
