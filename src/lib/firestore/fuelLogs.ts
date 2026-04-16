/**
 * Firestore — 주유 기록 (Fuel Logs) 관련 함수
 */
import {
    doc, deleteDoc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';

/** 주유 기록 목록 조회 (기관 전체, 최신순) */
export const getFuelLogs = async (orgId: string, vehicleId: string | null = null, options?: { since?: Date; until?: Date }) => {
    const constraints: import('firebase/firestore').QueryConstraint[] = [
        where('organizationId', '==', orgId),
    ];
    if (vehicleId) {
        constraints.push(where('vehicleId', '==', vehicleId));
    }
    if (options?.since) {
        constraints.push(where('date', '>=', options.since instanceof Date
            ? options.since.toISOString().slice(0, 10) : options.since));
    }
    if (options?.until) {
        constraints.push(where('date', '<=', options.until instanceof Date
            ? options.until.toISOString().slice(0, 10) : options.until));
    }
    constraints.push(orderBy('date', 'desc'), limit(200));
    const q = query(collection(db, 'fuelLogs'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
};

/** 주유 기록 생성 */
export const createFuelLog = async (data: Record<string, unknown>) => {
    try {
        const docRef = await addDoc(collection(db, 'fuelLogs'), {
            ...data,
            createdAt: serverTimestamp(),
        });
        return docRef;
    } catch (error) {
        captureError(error as Error, { context: 'createFuelLog', data });
        throw error;
    }
};

/** 주유 기록 삭제 */
export const deleteFuelLog = async (logId: string) => {
    try {
        await deleteDoc(doc(db, 'fuelLogs', logId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteFuelLog', logId });
        throw error;
    }
};

/** 주유 기록 수정 */
export const updateFuelLog = async (logId: string, data: Record<string, unknown>) => {
    try {
        await updateDoc(doc(db, 'fuelLogs', logId), {
            ...data,
            updatedAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error as Error, { context: 'updateFuelLog', logId, data });
        throw error;
    }
};
