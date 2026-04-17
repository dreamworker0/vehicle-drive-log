/**
 * Firestore — 차량 예약 (Reservations) 관련 함수
 */
import {
    doc, getDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp, onSnapshot, runTransaction,
    type DocumentData,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import app from '../firebase';
import { createZodConverter, reservationSchema } from '../../schemas';
import type { Reservation } from '../../types/reservation';
import { captureError } from '../sentry';

const functions = getFunctions(app, 'asia-northeast3');
const reservationsCollection = () => collection(db, 'reservations').withConverter(createZodConverter(reservationSchema));
const reservationDoc = (id: string) => doc(db, 'reservations', id).withConverter(createZodConverter(reservationSchema));

// 예약 ID로 단일 조회
export const getReservationById = async (reservationId: string) => {
    const snap = await getDoc(reservationDoc(reservationId));
    if (!snap.exists()) return null;
    return snap.data() as Reservation;
};

// 예약 생성 (클라이언트 측)
export const createReservation = async (data: Record<string, unknown>, requireApproval: boolean = false) => {
    try {
        const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
        const docRef = await addDoc(reservationsCollection(), {
            ...data,
            status: requireApproval ? 'pending' : 'reserved',
            createdAt: serverTimestamp(),
            expiresAt,
        } as any);
        return docRef.id;
    } catch (error) {
        captureError(error, { context: 'createReservation', data, requireApproval });
        throw error;
    }
};

/** 서버 측 중복 검증 기반 예약 생성 (Cloud Function + Firestore Transaction) */
export const createReservationSafe = async (data: Record<string, unknown>) => {
    try {
        const callable = httpsCallable(functions, 'createReservationSafe', { timeout: 15000 });
        const result = await callable(data);
        return (result.data as { reservationId: string }).reservationId;
    } catch (error: any) {
        // 중복 예약 및 유효성 검사 등 기대되는 비즈니스 로직 에러는 Sentry에 보고하지 않음
        if (error?.code !== 'functions/already-exists' && error?.code !== 'functions/invalid-argument') {
            captureError(error, { context: 'createReservationSafe', data });
        }
        throw error;
    }
};

// 날짜별 예약 목록 조회
export const getReservations = async (orgId: string, date?: string) => {
    const constraints = [
        where('organizationId', '==', orgId),
    ];
    if (date) {
        constraints.push(where('date', '==', date));
    }
    const q = query(reservationsCollection(), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Reservation);
};

// 예약 실시간 구독
export const subscribeReservations = (orgId: string, callback: (reservations: (DocumentData & { id: string })[]) => void) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
    );
    return onSnapshot(q, (snap) => {
        const reservations = snap.docs.map(d => d.data() as Reservation);
        callback(reservations);
    });
};

// 승인 대기 중인 예약 실시간 구독
export const subscribePendingReservations = (orgId: string, callback: (reservations: (DocumentData & { id: string })[]) => void) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('status', '==', 'pending')
    );
    return onSnapshot(q, (snap) => {
        const reservations = snap.docs.map(d => d.data() as Reservation);
        // 생성일 순으로 정렬 (가장 오래된 것이 위로 오게)
        reservations.sort((a, b) => {
            const timeA = typeof (a.createdAt as any)?.toMillis === 'function' ? (a.createdAt as any).toMillis() : 0;
            const timeB = typeof (b.createdAt as any)?.toMillis === 'function' ? (b.createdAt as any).toMillis() : 0;
            return timeA - timeB; // 오름차순
        });
        callback(reservations);
    });
};

// 승인 대기 중인 예약 일회성 조회 (getDocs 기반)
export const getPendingReservations = async (orgId: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('status', '==', 'pending')
    );
    const snap = await getDocs(q);
    const reservations = snap.docs.map(d => d.data() as Reservation);
    
    // 생성일 순으로 정렬 (가장 오래된 것이 위로 오게)
    reservations.sort((a, b) => {
        const timeA = typeof (a.createdAt as any)?.toMillis === 'function' ? (a.createdAt as any).toMillis() : 0;
        const timeB = typeof (b.createdAt as any)?.toMillis === 'function' ? (b.createdAt as any).toMillis() : 0;
        return timeA - timeB; // 오름차순
    });
    return reservations;
};

// 예약 취소
export const cancelReservation = async (reservationId: string) => {
    try {
        await updateDoc(reservationDoc(reservationId), {
            status: 'cancelled',
        });
    } catch (error) {
        captureError(error, { context: 'cancelReservation', reservationId });
        throw error;
    }
};

// 예약 정보 수정
export const updateReservation = async (reservationId: string, data: Record<string, unknown>) => {
    try {
        await updateDoc(reservationDoc(reservationId), data);
    } catch (error) {
        captureError(error, { context: 'updateReservation', reservationId, data });
        throw error;
    }
};

// 예약 상태 변경 (온라인 트랜잭션 또는 오프라인 큐 낙관적 업데이트)
export const updateReservationStatus = async (
    reservationId: string, 
    status: string, 
    extraData: Record<string, unknown> = {},
    expectedCurrentStatus?: string
) => {
    try {
        const reservationRef = reservationDoc(reservationId);
        
        // 운행 종료 등 사용자가 직접 업데이트하는 경우, 오프라인 큐 및 즉각적인 UI 반영(낙관적 업데이트)을 위해 일반 updateDoc 사용.
        // expectedCurrentStatus가 들어오는 경우(관리자 승인 등)만 동시성 방어를 위해 트랜잭션(온라인 한정) 사용.
        if (!expectedCurrentStatus) {
            await updateDoc(reservationRef, {
                status,
                ...extraData,
            });
            return;
        }

        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(reservationRef);
            if (!sfDoc.exists()) {
                throw new Error("예약 정보가 존재하지 않습니다.");
            }
            
            const currentData = sfDoc.data();
            if (expectedCurrentStatus && currentData.status !== expectedCurrentStatus) {
                throw new Error(`동시성 오류: 이미 다른 관리자에 의해 상태가 변경되었습니다. (현재 상태: ${currentData.status})`);
            }
            
            transaction.update(reservationRef, {
                status,
                ...extraData,
            });
        });
    } catch (error) {
        captureError(error, { context: 'updateReservationStatus', reservationId, status, extraData, expectedCurrentStatus });
        throw error;
    }
};

// 오늘 예약 조회 (취소 제외)
export const getTodayReservations = async (orgId: string, date: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('date', '==', date),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => d.data() as Reservation)
        .filter(r => r.status !== 'cancelled');
};

// 주간 예약 조회 (취소 제외)
export const getWeekReservations = async (orgId: string, startDate: string, endDate: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => d.data() as Reservation)
        .filter(r => r.status !== 'cancelled' && (r.date ?? '') >= startDate && (r.date ?? '') <= endDate);
};

// 날짜 범위별 예약 조회 (getWeekReservations 별칭)
export const getReservationsByDateRange = getWeekReservations;

// groupId로 연속 예약 그룹 조회
// Firestore Rules가 organizationId 기반 접근 제어를 하므로 orgId 필터 필수
export const getReservationsByGroupId = async (groupId: string, orgId: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('groupId', '==', groupId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => d.data() as Reservation)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

// 연속 예약 그룹 일괄 취소
export const cancelReservationGroup = async (groupId: string, orgId: string) => {
    try {
        const reservations = await getReservationsByGroupId(groupId, orgId);
        const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
        await Promise.all(
            active.map(r => updateDoc(reservationDoc(r.id), { status: 'cancelled' }))
        );
        return active.length;
    } catch (error) {
        captureError(error, { context: 'cancelReservationGroup', groupId, orgId });
        throw error;
    }
};

// 연속 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteReservationGroup = async (groupId: string, orgId: string) => {
    try {
        const reservations = await getReservationsByGroupId(groupId, orgId);
        const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
        await Promise.all(
            active.map(r => deleteDoc(reservationDoc(r.id)))
        );
        return active.length;
    } catch (error) {
        captureError(error, { context: 'deleteReservationGroup', groupId, orgId });
        throw error;
    }
};

// 내 최근 예약 조회 (취소 제외, 최신 순 정렬하여 반환)
// 복합 인덱스 생성을 피하기 위해 클라이언트 메모리에서 정렬 처리
export const getMyRecentReservations = async (orgId: string, uid: string, limitCount = 50) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('reservedByUid', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => d.data() as Reservation)
        .filter(r => r.status !== 'cancelled')
        .sort((a, b) => ((b.date || '') + (b.startTime || '')).localeCompare((a.date || '') + (a.startTime || '')))
        .slice(0, limitCount);
};

// ─── 반복(정기) 예약 그룹 관련 ───

// recurringGroupId로 반복 예약 그룹 조회
export const getReservationsByRecurringGroupId = async (recurringGroupId: string, orgId: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('recurringGroupId', '==', recurringGroupId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => d.data() as Reservation)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

// 반복 예약 그룹 일괄 취소
export const cancelRecurringGroup = async (recurringGroupId: string, orgId: string) => {
    try {
        const reservations = await getReservationsByRecurringGroupId(recurringGroupId, orgId);
        const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
        await Promise.all(
            active.map(r => updateDoc(reservationDoc(r.id), { status: 'cancelled' }))
        );
        return active.length;
    } catch (error) {
        captureError(error, { context: 'cancelRecurringGroup', recurringGroupId, orgId });
        throw error;
    }
};

// 반복 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteRecurringGroup = async (recurringGroupId: string, orgId: string) => {
    try {
        const reservations = await getReservationsByRecurringGroupId(recurringGroupId, orgId);
        const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
        await Promise.all(
            active.map(r => deleteDoc(reservationDoc(r.id)))
        );
        return active.length;
    } catch (error) {
        captureError(error, { context: 'deleteRecurringGroup', recurringGroupId, orgId });
        throw error;
    }
};
