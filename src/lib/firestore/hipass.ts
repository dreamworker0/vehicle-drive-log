/**
 * Firestore — 하이패스 카드 (HipassCards) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import type { HipassCard } from '../../types/hipass';

// 기관 소속 하이패스 카드 목록 조회
export const getHipassCards = async (orgId: string): Promise<HipassCard[]> => {
    const q = query(
        collection(db, 'hipassCards'),
        where('organizationId', '==', orgId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as HipassCard)
        .sort((a, b) => ((b as HipassCard & { createdAt?: { seconds: number } }).createdAt?.seconds ?? 0) - ((a as HipassCard & { createdAt?: { seconds: number } }).createdAt?.seconds ?? 0));
};

// 하이패스 카드 등록
export const createHipassCard = async (data: Record<string, unknown>) => {
    try {
        const docRef = await addDoc(collection(db, 'hipassCards'), {
            ...data,
            balance: data.balance ?? 0,
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (error) {
        captureError(error as Error, { context: 'createHipassCard', data });
        throw error;
    }
};

// 하이패스 카드 수정
export const updateHipassCard = async (cardId: string, data: Record<string, unknown>) => {
    try {
        const promise = updateDoc(doc(db, 'hipassCards', cardId), {
            ...data,
            updatedAt: serverTimestamp(),
        });
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        if (!isOffline) {
            await promise;
        } else {
            promise.catch(e => console.error('[Firestore Offline Sync Error]', e));
        }
    } catch (error) {
        captureError(error as Error, { context: 'updateHipassCard', cardId, data });
        throw error;
    }
};

// 하이패스 카드 삭제
export const deleteHipassCard = async (cardId: string) => {
    try {
        await deleteDoc(doc(db, 'hipassCards', cardId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteHipassCard', cardId });
        throw error;
    }
};
