/**
 * Firestore — 하이패스 충전 기록 (HipassCharges) 관련 함수
 */
import {
    doc, deleteDoc,
    collection, query, where, orderBy, getDocs, addDoc,
    serverTimestamp, limit,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import { toLocalDateStr } from '../dateUtils';

/** 기관 전체 하이패스 충전 기록 조회 (최신순, 200건) */
export const getAllHipassCharges = async (orgId: string, options?: { since?: Date; until?: Date }) => {
    const constraints: import('firebase/firestore').QueryConstraint[] = [
        where('organizationId', '==', orgId),
    ];
    if (options?.since) {
        constraints.push(where('date', '>=', options.since instanceof Date
            ? toLocalDateStr(options.since) : options.since));
    }
    if (options?.until) {
        constraints.push(where('date', '<=', options.until instanceof Date
            ? toLocalDateStr(options.until) : options.until));
    }
    constraints.push(orderBy('date', 'desc'), limit(200));
    const q = query(collection(db, 'hipassCharges'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
};

// 카드별 충전 기록 조회 (최신순, 최대 100건)
export const getHipassCharges = async (orgId: string, cardId: string) => {
    const q = query(
        collection(db, 'hipassCharges'),
        where('organizationId', '==', orgId),
        where('cardId', '==', cardId),
        orderBy('createdAt', 'desc'),
        limit(100),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 충전 기록 생성
export const createHipassCharge = async (data: Record<string, unknown>) => {
    try {
        const docRef = await addDoc(collection(db, 'hipassCharges'), {
            ...data,
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (error) {
        captureError(error as Error, { context: 'createHipassCharge', data });
        throw error;
    }
};

// 충전 기록 삭제
export const deleteHipassCharge = async (chargeId: string) => {
    try {
        await deleteDoc(doc(db, 'hipassCharges', chargeId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteHipassCharge', chargeId });
        throw error;
    }
};
