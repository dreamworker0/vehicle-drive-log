/**
 * Firestore — 커스텀 휴일 (Custom Holidays) 관련 함수
 */
import {
    doc, deleteDoc,
    collection, query, getDocs, addDoc,
    orderBy, serverTimestamp,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

// 기관 커스텀 휴일 목록 조회
export const getCustomHolidays = async (orgId: string) => {
    const q = query(
        collection(db, 'organizations', orgId, 'customHolidays'),
        orderBy('date', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 커스텀 휴일 추가
export const addCustomHoliday = async (orgId: string, data: Record<string, unknown>) => {
    const docRef = await addDoc(collection(db, 'organizations', orgId, 'customHolidays'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 커스텀 휴일 삭제
export const deleteCustomHoliday = async (orgId: string, holidayId: string) => {
    await deleteDoc(doc(db, 'organizations', orgId, 'customHolidays', holidayId));
};
