/**
 * Firestore — 하이패스 충전 기록 (HipassCharges) 관련 함수
 */
import {
    doc, deleteDoc,
    collection, query, where, orderBy, getDocs, addDoc,
    serverTimestamp, limit,
} from 'firebase/firestore';
import { db } from '../firebase';

/** 기관 전체 하이패스 충전 기록 조회 (최신순, 200건) */
export const getAllHipassCharges = async (orgId: string, options?: { since?: Date; until?: Date }) => {
    const constraints: import('firebase/firestore').QueryConstraint[] = [
        where('organizationId', '==', orgId),
    ];
    if (options?.since) {
        constraints.push(where('date', '>=', options.since instanceof Date
            ? options.since.toISOString().slice(0, 10) : options.since));
    }
    if (options?.until) {
        constraints.push(where('date', '<=', options.until instanceof Date
            ? options.until.toISOString().slice(0, 10) : options.until));
    }
    constraints.push(orderBy('date', 'desc'), limit(200));
    const q = query(collection(db, 'hipassCharges'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, any>) }));
};

// 카드별 충전 기록 조회 (최신순)
export const getHipassCharges = async (orgId: string, cardId: string) => {
    const q = query(
        collection(db, 'hipassCharges'),
        where('organizationId', '==', orgId),
        where('cardId', '==', cardId),
        orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
};

// 충전 기록 생성
export const createHipassCharge = async (data: Record<string, any>) => {
    const docRef = await addDoc(collection(db, 'hipassCharges'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 충전 기록 삭제
export const deleteHipassCharge = async (chargeId: string) => {
    await deleteDoc(doc(db, 'hipassCharges', chargeId));
};
