/**
 * Firestore — 하이패스 카드 (HipassCards) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { actorStamp } from './actorStamp';
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
/**
 * 하이패스 카드 수정.
 *
 * **행위자 스탬프를 함께 남긴다.** 잔액(balance)은 서버 트리거가 소유하지만(Phase 227),
 * [하이패스 관리]에서 실물 카드와 맞추는 수동 정정만은 사람이 한다. 그 경로가 유일하게
 * 남은 수동 잔액 변경이라 "누가 고쳤나"가 남아야 하고, Rules가 잔액을 바꾸는 쓰기에
 * 이 스탬프를 요구한다(값은 토큰과 대조되므로 타인 명의로 위조할 수 없다).
 */
export const updateHipassCard = async (cardId: string, data: Record<string, unknown>) => {
    try {
        const promise = updateDoc(doc(db, 'hipassCards', cardId), {
            ...data,
            ...actorStamp(),
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
