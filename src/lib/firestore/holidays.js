/**
 * Firestore — 커스텀 휴일 (Custom Holidays) 관련 함수
 */
import {
    doc, deleteDoc,
    collection, query, getDocs, addDoc,
    orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// 기관 커스텀 휴일 목록 조회
export const getCustomHolidays = async (orgId) => {
    const q = query(
        collection(db, 'organizations', orgId, 'customHolidays'),
        orderBy('date', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 커스텀 휴일 추가
export const addCustomHoliday = async (orgId, data) => {
    const docRef = await addDoc(collection(db, 'organizations', orgId, 'customHolidays'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 커스텀 휴일 삭제
export const deleteCustomHoliday = async (orgId, holidayId) => {
    await deleteDoc(doc(db, 'organizations', orgId, 'customHolidays', holidayId));
};
