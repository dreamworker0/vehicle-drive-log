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

// 기간(since/until) 조회 상한 — 월간 보고서가 운행일지 상한(EXPORT_MAX_DOCS=5000)과 같은
// 수준으로 집계하도록 맞춘다. 기간 없는 화면 목록 조회는 기존대로 200건 유지.
const RANGE_FETCH_MAX = 5000;
const LIST_FETCH_MAX = 200;

/** 기관 전체 하이패스 충전 기록 조회 (최신순 — 기간 지정 시 상한 5,000건, 미지정 시 200건) */
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
    const hasRange = Boolean(options?.since || options?.until);
    constraints.push(orderBy('date', 'desc'), limit(hasRange ? RANGE_FETCH_MAX : LIST_FETCH_MAX));
    const q = query(collection(db, 'hipassCharges'), ...constraints);
    const snap = await getDocs(q);
    if (hasRange && snap.docs.length >= RANGE_FETCH_MAX) {
        console.warn(`[getAllHipassCharges] 기간 조회가 상한 ${RANGE_FETCH_MAX}건에 도달 — 이후 충전 기록은 집계에서 누락될 수 있습니다.`);
    }
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
