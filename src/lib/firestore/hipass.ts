/**
 * Firestore — 하이패스 카드 (HipassCards) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// 기관 소속 하이패스 카드 목록 조회
export const getHipassCards = async (orgId: string) => {
    const q = query(
        collection(db, 'hipassCards'),
        where('organizationId', '==', orgId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
};

// 하이패스 카드 등록
export const createHipassCard = async (data: Record<string, any>) => {
    const docRef = await addDoc(collection(db, 'hipassCards'), {
        ...data,
        balance: data.balance ?? 0,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 하이패스 카드 수정
export const updateHipassCard = async (cardId: string, data: Record<string, any>) => {
    await updateDoc(doc(db, 'hipassCards', cardId), {
        ...data,
        updatedAt: serverTimestamp(),
    });
};

// 하이패스 카드 삭제
export const deleteHipassCard = async (cardId: string) => {
    await deleteDoc(doc(db, 'hipassCards', cardId));
};
