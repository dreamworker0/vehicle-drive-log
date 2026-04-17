/**
 * driveLogs/utils.ts
 * 운행일지 관련 유틸리티 함수 — Firestore 직접 의존 없이 공통으로 사용되는 헬퍼
 */
import {
    doc, updateDoc,
    collection, query, where, getDocs,
    orderBy, limit, serverTimestamp,
    type QueryDocumentSnapshot,
    type SnapshotOptions
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DriveLog } from '../../../types/driveLog';
import { captureError } from '../../sentry';

/**
 * undefined / NaN 필드를 Firestore에 저장하기 전에 제거하는 유틸
 * Firebase 특별 객체(Timestamp, FieldValue)는 보존
 */
export const sanitizeUndefined = <T>(obj: T): T => {
    if (obj === undefined) return undefined as unknown as T;
    if (obj === null) return null as unknown as T;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(sanitizeUndefined).filter(v => v !== undefined) as unknown as T;
    }
    if (obj instanceof Date) return obj;
    
    const objRecord = obj as Record<string, unknown>;
    // Firebase 특별 객체 (Timestamp, FieldValue 등)
    if (typeof objRecord.toDate === 'function' || 
        typeof objRecord.isEqual === 'function' || 
        ('seconds' in objRecord && 'nanoseconds' in objRecord)) {
        return obj;
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        // 명시적으로 undefined 및 NaN 제외
        if (v === undefined) continue;
        if (typeof v === 'number' && Number.isNaN(v)) continue;
        
        const sanitized = sanitizeUndefined(v);
        if (sanitized !== undefined && !(typeof sanitized === 'number' && Number.isNaN(sanitized))) {
            result[k] = sanitized;
        }
    }
    return result as T;
};

/** 특정 시점 이후에 같은 차량의 운행기록이 존재하는지 확인 */
export const hasLaterDriveLog = async (orgId: string, vehicleId: string, afterTimestamp: Date) => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('timestamp', '>', afterTimestamp),
            limit(1)
        );
        const snap = await getDocs(q);
        return !snap.empty;
    } catch (error) {
        captureError(error, { context: 'hasLaterDriveLog', orgId, vehicleId });
        throw error;
    }
};

/** 차량의 마지막 운행기록에서 endKm 조회 (currentKm과 비교하여 큰 값 반환) */
export const getLastVehicleEndKm = async (orgId: string, vehicleId: string) => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('timestamp', 'desc'),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const lastLog = snap.docs[0].data();
        return lastLog.endKm || null;
    } catch (error) {
        captureError(error, { context: 'getLastVehicleEndKm', orgId, vehicleId });
        throw error;
    }
};

/** 차량의 마지막 운행기록에서 도착 배터리(%) 조회 — 출발 배터리 힌트용 */
export const getLastVehicleEndBattery = async (orgId: string, vehicleId: string): Promise<number | null> => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('timestamp', 'desc'),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const lastLog = snap.docs[0].data();
        return lastLog.batteryEnd ?? null;
    } catch (error) {
        captureError(error, { context: 'getLastVehicleEndBattery', orgId, vehicleId });
        throw error;
    }
};

/** 특정 날짜 이전의 가장 최근 운행기록에서 endKm 조회 (소급 입력용) */
export const getVehicleEndKmBefore = async (orgId: string, vehicleId: string, beforeDate: Date) => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('timestamp', '<', beforeDate),
            orderBy('timestamp', 'desc'),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        return snap.docs[0].data().endKm || null;
    } catch (error) {
        captureError(error, { context: 'getVehicleEndKmBefore', orgId, vehicleId });
        throw error;
    }
};

/**
 * 소급 입력/수정 시 같은 차량의 이후 모든 운행기록 startKm을 연쇄적으로 자동 업데이트
 * - 직전 기록의 endKm → 다음 기록의 startKm 으로 순차 갱신
 * - 최대 20개까지 연쇄 업데이트 (무한 루프 방지)
 * @returns {{ updated: boolean, logId?: string, oldStartKm?: number, newStartKm?: number, chainCount?: number }}
 */
export const syncNextLogStartKm = async (orgId: string, vehicleId: string, afterDate: Date, newStartKm: number) => {
    try {
        let currentAfterDate = afterDate;
        let carryKm = newStartKm; // 다음 기록에 전달할 startKm
        let firstResult: { updated: boolean; logId?: string; oldStartKm?: number; newStartKm?: number } = { updated: false };
        let chainCount = 0;
        const MAX_CHAIN = 20;

        while (chainCount < MAX_CHAIN) {
            const q = query(
                collection(db, 'driveLogs'),
                where('organizationId', '==', orgId),
                where('vehicleId', '==', vehicleId),
                where('timestamp', '>', currentAfterDate),
                orderBy('timestamp', 'asc'),
                limit(1)
            );
            const snap = await getDocs(q);
            if (snap.empty) break;

            const nextDoc = snap.docs[0];
            const nextData = nextDoc.data();
            const oldStartKm = nextData.startKm;

            // startKm이 이미 맞으면 연쇄 중단 (이후 기록도 영향 없음)
            if (oldStartKm === carryKm) break;

            await updateDoc(doc(db, 'driveLogs', nextDoc.id), {
                startKm: carryKm,
                editedAt: serverTimestamp(),
            });

            if (chainCount === 0) {
                firstResult = { updated: true, logId: nextDoc.id, oldStartKm, newStartKm: carryKm };
            }

            // 다음 연쇄: 현재 기록의 endKm → 그 다음 기록의 startKm
            carryKm = nextData.endKm ?? carryKm;
            currentAfterDate = nextData.timestamp instanceof Date
                ? nextData.timestamp
                : (nextData.timestamp?.toDate ? nextData.timestamp.toDate() : new Date(nextData.timestamp));
            chainCount++;
        }

        return { ...firstResult, chainCount };
    } catch (error) {
        captureError(error, { context: 'syncNextLogStartKm', orgId, vehicleId });
        throw error;
    }
};

/** 운행일지 중복 정리 (Cloud Function 호출) */
export const cleanupDuplicateLogs = async (organizationId: string, { dryRun = true } = {}) => {
    try {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const functions = getFunctions(undefined, 'asia-northeast3');
        const callable = httpsCallable(functions, 'cleanupDuplicateLogs', { timeout: 120000 });
        const result = await callable({ organizationId, dryRun });
        return result.data;
    } catch (error) {
        const { captureError } = await import('../../sentry');
        captureError(error, { context: 'cleanupDuplicateLogs', organizationId, dryRun });
        throw error;
    }
};
