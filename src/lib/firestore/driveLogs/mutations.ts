/**
 * driveLogs/mutations.ts
 * 운행일지 쓰기(Create/Update/Delete) 작업 — CQRS 쓰기 측
 */
import {
    doc, updateDoc, deleteDoc, setDoc,
    collection, query, where, getDocs,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DriveLog } from '../../../types/driveLog';
import { captureError } from '../../sentry';
import {
    sanitizeUndefined,
    getVehicleEndKmBefore,
} from './utils';
import { driveLogSchema } from '../../../schemas';

export interface CreateDriveLogResult {
    id: string;
    syncResult: { updated?: boolean; oldStartKm?: number; newStartKm?: number } | null;
    correctedStartKm?: number;
    oldStartKm?: number;
    backgroundError: Error | string | null;
}

export interface UpdateDriveLogResult {
    syncResult: { updated?: boolean; oldStartKm?: number; newStartKm?: number } | null;
    backgroundError: Error | string | null;
}

// 운행일지 생성 (중복 방지 체크 포함)
export const createDriveLog = async (data: Partial<DriveLog>): Promise<CreateDriveLogResult> => {
    try {
        const logDate = data.timestamp instanceof Date ? data.timestamp : new Date();

        // 중복 체크: 같은 기관+차량+운전자+startKm+endKm 이 같은 날짜에 이미 존재하면 거부
        if (data.organizationId && data.vehicleId && data.driverUid && data.startKm != null && data.endKm != null) {
            const dayStart = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate());
            const dayEnd = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate() + 1);

            const dupQuery = query(
                collection(db, 'driveLogs'),
                where('organizationId', '==', data.organizationId),
                where('vehicleId', '==', data.vehicleId),
                where('driverUid', '==', data.driverUid),
                where('timestamp', '>=', dayStart),
                where('timestamp', '<', dayEnd),
            );
            const dupSnap = await getDocs(dupQuery);
            const duplicate = dupSnap.docs.some(d => {
                const existing = d.data();
                return existing.startKm === data.startKm && existing.endKm === data.endKm;
            });
            if (duplicate) {
                throw new Error('동일한 운행 기록이 이미 존재합니다. 중복 저장을 방지했습니다.');
            }
        }

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

        // === [추가된 방어 로직] 출발 Km 자동 보정 ===
        const originalStartKm = data.startKm;
        const correctedStartKm = originalStartKm || 0;
        const autocorrectedDistance = false;

        if (data.organizationId && data.vehicleId && data.endKm != null && data.startKm != null && data.timestamp && !isOffline) {
            const logDate = data.timestamp instanceof Date ? data.timestamp : (data.timestamp as import("firebase/firestore").Timestamp).toDate ? (data.timestamp as import("firebase/firestore").Timestamp).toDate() : new Date();
            // 방금 입력하려는 시간 기준 "직전" 기록의 endKm을 조회
            const beforeEndKm = await getVehicleEndKmBefore(data.organizationId as string, data.vehicleId as string, logDate);

            // 직전 기록이 존재하고, 직전 마지막 도착 km가 현재 폼의 출발 km와 다르다면
            if (beforeEndKm !== null && beforeEndKm !== correctedStartKm) {
                const error = new Error('직전 운행 기록과 출발 주행거리가 일치하지 않습니다.');
                Object.assign(error, {
                    code: 'REQUIRES_START_KM_CONFIRMATION',
                    suggestedStartKm: beforeEndKm,
                    originalStartKm: correctedStartKm
                });
                throw error;
            }
        }
        // === 끝 ===

        // zod 스키마로 런타임 값 검증 (실패 시 ZodError throw)
        driveLogSchema.parse(data);

        // Use a deterministic generated ID for offline idempotency (if provided from client)
        const docRef = data.id ? doc(db, 'driveLogs', data.id as string) : doc(collection(db, 'driveLogs'));
        const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
        const finalData = sanitizeUndefined({ ...data, id: docRef.id, createdAt: serverTimestamp(), expiresAt });
        const promise = setDoc(docRef, finalData);

        if (isOffline) {
            import('../../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('CREATE_DRIVELOG', { ...data, id: docRef.id })).catch(() => console.warn('[offlineSync] CREATE_DRIVELOG 큐잉 실패'));
        }
        await promise;

        // 기존 클라이언트 측 차량 km 갱신 및 startKm 연쇄 보정 로직은 
        // Cloud Functions(syncDriveLogKm.ts)의 트리거로 이전되어 삭제됨

        return { 
            id: docRef.id, 
            syncResult: null,
            correctedStartKm: autocorrectedDistance ? correctedStartKm : undefined,
            oldStartKm: autocorrectedDistance ? originalStartKm : undefined,
            backgroundError: null,
        };
    } catch (error) {
        // 중복 저장 방지 / 동기화 오류는 의도된 비즈니스 로직이므로 Sentry에 보고하지 않음
        const isBizError = error instanceof Error && (error.message.includes('중복') || error.message.includes('동기화 오류'));
        if (!isBizError) {
            captureError(error, { context: 'createDriveLog', data });
        }
        throw error;
    }
};

// 운행일지 수정
export const updateDriveLog = async (logId: string, data: Partial<DriveLog>): Promise<UpdateDriveLogResult> => {
    try {
        const logRef = doc(db, 'driveLogs', logId);
        
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const finalData = sanitizeUndefined({ ...data, editedAt: serverTimestamp() });
        const promise = updateDoc(logRef, finalData);

        if (isOffline) {
            import('../../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('UPDATE_DRIVELOG', { ...data, id: logId })).catch(() => console.warn('[offlineSync] UPDATE_DRIVELOG 큐잉 실패'));
        }
        await promise; // 본체 갱신 완료까지는 기다림

        // 기존 클라이언트 측 차량 km 갱신 및 startKm 연쇄 보정 로직은 
        // Cloud Functions(syncDriveLogKm.ts)의 트리거로 이전되어 삭제됨

        return { syncResult: null, backgroundError: null };
    } catch (error) {
        captureError(error, { context: 'updateDriveLog', logId, data });
        throw error;
    }
};

// 운행일지 삭제
export const deleteDriveLog = async (logId: string) => {
    try {
        await deleteDoc(doc(db, 'driveLogs', logId));
    } catch (error) {
        captureError(error, { context: 'deleteDriveLog', logId });
        throw error;
    }
};
