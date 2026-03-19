/**
 * Firestore — 주유 기록 (Fuel Logs) 관련 함수
 */
import {
    doc, deleteDoc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

/** 주유 기록 목록 조회 (기관 전체, 최신순) */
export const getFuelLogs = async (orgId: string, vehicleId: string | null = null) => {
    let q;
    if (vehicleId) {
        q = query(
            collection(db, 'fuelLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('date', 'desc'),
            limit(200)
        );
    } else {
        q = query(
            collection(db, 'fuelLogs'),
            where('organizationId', '==', orgId),
            orderBy('date', 'desc'),
            limit(200)
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, any>) }));
};

/** 주유 기록 생성 */
export const createFuelLog = async (data: Record<string, any>) => {
    const docRef = await addDoc(collection(db, 'fuelLogs'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef;
};

/** 주유 기록 삭제 */
export const deleteFuelLog = async (logId: string) => {
    await deleteDoc(doc(db, 'fuelLogs', logId));
};

/** 주유 기록 수정 */
export const updateFuelLog = async (logId: string, data: Record<string, any>) => {
    await updateDoc(doc(db, 'fuelLogs', logId), {
        ...data,
        updatedAt: serverTimestamp(),
    });
};
