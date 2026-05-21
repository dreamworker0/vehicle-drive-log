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

/** 차량의 마지막 운행기록 객체 조회 */
export const getLastVehicleDriveLog = async (
    orgId: string, 
    vehicleId: string,
    excludeId?: string
): Promise<DriveLog | null> => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('timestamp', 'desc'),
            limit(excludeId ? 2 : 1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        
        const docs = snap.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        } as DriveLog));
        
        if (excludeId) {
            const filtered = docs.filter(d => d.id !== excludeId);
            return filtered.length > 0 ? filtered[0] : null;
        }
        
        return docs[0];
    } catch (error) {
        captureError(error, { context: 'getLastVehicleDriveLog', orgId, vehicleId });
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

/**
 * 수정 대상 로그의 직전 로그(prev)와 직후 로그(next)를 효율적으로 한 번에 조회
 * - Firestore 복합 인덱스 에러 방지를 위해 orderBy('timestamp', 'desc') 쿼리 활용
 */
export const getAdjacentDriveLogs = async (
    orgId: string,
    vehicleId: string,
    currentLog: DriveLog
): Promise<{ prev: DriveLog | null; next: DriveLog | null }> => {
    try {
        const rawTimestamp = currentLog.timestamp;
        let currentTimestamp: Date;
        if (rawTimestamp instanceof Date) {
            currentTimestamp = rawTimestamp;
        } else if (
            rawTimestamp &&
            typeof rawTimestamp === 'object' &&
            'toDate' in rawTimestamp &&
            typeof (rawTimestamp as { toDate: () => unknown }).toDate === 'function'
        ) {
            currentTimestamp = (rawTimestamp as { toDate: () => Date }).toDate();
        } else if (
            rawTimestamp &&
            typeof rawTimestamp === 'object' &&
            'seconds' in rawTimestamp &&
            typeof (rawTimestamp as { seconds: number }).seconds === 'number'
        ) {
            // React Router state 직렬화로 toDate()가 소실된 Firestore Timestamp 처리
            currentTimestamp = new Date((rawTimestamp as { seconds: number }).seconds * 1000);
        } else {
            currentTimestamp = new Date(rawTimestamp as unknown as string | number);
        }

        // 유효하지 않은 날짜일 경우 빈 결과 반환 (에러 방지)
        if (isNaN(currentTimestamp.getTime())) {
            return { prev: null, next: null };
        }

        // 1. 직전 로그 조회: currentTimestamp 이하인 것 중 본인 제외 최근 것 (최대 2개 가져와서 필터링)
        const prevQuery = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('timestamp', '<=', currentTimestamp),
            orderBy('timestamp', 'desc'),
            limit(2)
        );
        const prevSnap = await getDocs(prevQuery);
        const prevDocs = prevSnap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DriveLog))
            .filter(d => d.id !== currentLog.id);
        const prev = prevDocs.length > 0 ? prevDocs[0] : null;

        // 2. 직후 로그 조회: currentTimestamp 보다 큰 것 중 본인 제외 가장 과거 것 (최대 10개 가져와서 필터링 후 가장 마지막 원소)
        const nextQuery = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('timestamp', '>', currentTimestamp),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const nextSnap = await getDocs(nextQuery);
        const nextDocs = nextSnap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DriveLog))
            .filter(d => d.id !== currentLog.id);
        const next = nextDocs.length > 0 ? nextDocs[nextDocs.length - 1] : null;

        return { prev, next };
    } catch (error) {
        captureError(error, { context: 'getAdjacentDriveLogs', orgId, vehicleId, currentLogId: currentLog.id });
        throw error;
    }
};

