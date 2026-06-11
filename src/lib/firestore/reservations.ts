/**
 * Firestore — 차량 예약 (Reservations) 관련 함수
 */
import {
    doc, getDoc, updateDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp, runTransaction, writeBatch, Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions, auth } from '../firebase';
import { createZodConverter, reservationSchema } from '../../schemas';
import type { Reservation } from '../../types/reservation';
import { captureError } from '../sentry';
import { enqueue } from '../offline/syncQueue';

const functions = firebaseFunctions;
const reservationsCollection = () => collection(db, 'reservations').withConverter(createZodConverter(reservationSchema));
const reservationDoc = (id: string) => doc(db, 'reservations', id).withConverter(createZodConverter(reservationSchema));

// 예약 ID로 단일 조회
export const getReservationById = async (reservationId: string) => {
    try {
        const snap = await getDoc(reservationDoc(reservationId));
        if (!snap.exists()) return null;
        return snap.data() as Reservation;
    } catch (error) {
        captureError(error, { context: 'getReservationById', reservationId });
        throw error;
    }
};

// 예약 ID 및 조직 ID로 단일 조회 (조직 격리 보호)
export const getReservationByIdAndOrg = async (reservationId: string, orgId: string) => {
    try {
        const snap = await getDoc(reservationDoc(reservationId));
        if (!snap.exists()) return null;
        const data = snap.data() as Reservation;
        if (data.organizationId !== orgId) {
            console.warn(`[Security Warning] Unauthorized access attempt to reservation ${reservationId} from organization ${orgId}`);
            return null;
        }
        return data;
    } catch (error) {
        captureError(error, { context: 'getReservationByIdAndOrg', reservationId, orgId });
        throw error;
    }
};

// 예약 생성 (클라이언트 측)
export const createReservation = async (data: Partial<Reservation>, requireApproval: boolean = false) => {
    try {
        // zod 스키마로 런타임 값 검증 (실패 시 ZodError throw)
        reservationSchema.parse(data);

        const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
        const docRef = await addDoc(reservationsCollection(), {
            ...data,
            status: requireApproval ? 'pending' : 'reserved',
            createdAt: serverTimestamp(),
            expiresAt,
        } as Record<string, unknown>);
        return docRef.id;
    } catch (error) {
        captureError(error, { context: 'createReservation', data, requireApproval });
        throw error;
    }
};

/** 서버 측 중복 검증 기반 예약 생성 (Cloud Function + Firestore Transaction) */
export const createReservationSafe = async (data: Partial<Reservation>) => {
    try {
        // 모바일 백그라운드 복귀 시 Firebase 토큰 만료에 따른 Unauthenticated 에러 방지
        if (auth.currentUser) {
            await auth.currentUser.getIdToken();
        }

        const callable = httpsCallable(functions, 'createReservationSafe', { timeout: 60000 });
        const result = await callable(data);
        return (result.data as { reservationId: string }).reservationId;
    } catch (error: unknown) {
        // 중복 예약 및 유효성 검사 등 기대되는 비즈니스 로직 에러는 Sentry에 보고하지 않음
        const err = error as { code?: string };
        if (err?.code !== 'functions/already-exists' && err?.code !== 'functions/invalid-argument') {
            captureError(error, { context: 'createReservationSafe', data });
        }
        throw error;
    }
};

// 날짜별 예약 목록 조회
export const getReservations = async (orgId: string, date?: string) => {
    try {
        const constraints = [
            where('organizationId', '==', orgId),
        ];
        if (date) {
            constraints.push(where('date', '==', date));
        } else {
            // date 미지정 시 최근 1개월로 제한 (Firestore 읽기 비용 절감)
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            constraints.push(where('date', '>=', oneMonthAgo.toISOString().slice(0, 10)));
        }
        const q = query(reservationsCollection(), ...constraints);
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as Reservation);
    } catch (error) {
        captureError(error, { context: 'getReservations', orgId, date });
        throw error;
    }
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
        const timeA = typeof (a.createdAt as Timestamp)?.toMillis === 'function' ? (a.createdAt as Timestamp).toMillis() : 0;
        const timeB = typeof (b.createdAt as Timestamp)?.toMillis === 'function' ? (b.createdAt as Timestamp).toMillis() : 0;
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
export const updateReservation = async (reservationId: string, data: Partial<Reservation>) => {
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
    extraData: Partial<Reservation> = {},
    expectedCurrentStatus?: string
) => {
    try {
        const reservationRef = reservationDoc(reservationId);
        
        // 운행 종료 등 사용자가 직접 업데이트하는 경우, 오프라인 큐 및 즉각적인 UI 반영(낙관적 업데이트)을 위해 일반 updateDoc 사용.
        // expectedCurrentStatus가 들어오는 경우(관리자 승인 등)만 동시성 방어를 위해 트랜잭션(온라인 한정) 사용.
        if (!expectedCurrentStatus) {
            const promise = updateDoc(reservationRef, {
                status,
                ...extraData,
            });
            const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
            if (!isOffline) {
                await promise;
            } else {
                promise.catch(e => console.error('[Firestore Offline Sync Error]', e));
                await enqueue('UPDATE', 'reservations', reservationId, { status, ...extraData });
                if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
                    navigator.serviceWorker.ready.then(reg => {
                        const syncReg = reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };
                        if (syncReg.sync) syncReg.sync.register('sync-db');
                    });
                }
            }
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
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('date', '==', date),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled');
    } catch (error) {
        captureError(error, { context: 'getTodayReservations', orgId, date });
        throw error;
    }
};

// 주간 예약 조회 (취소 제외)
export const getWeekReservations = async (orgId: string, startDate: string, endDate: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled');
    } catch (error) {
        captureError(error, { context: 'getWeekReservations', orgId, startDate, endDate });
        throw error;
    }
};

// 날짜 범위별 예약 조회 (getWeekReservations 별칭)
export const getReservationsByDateRange = getWeekReservations;

// groupId로 연속 예약 그룹 조회
// Firestore Rules가 organizationId 기반 접근 제어를 하므로 orgId 필터 필수
export const getReservationsByGroupId = async (groupId: string, orgId: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('groupId', '==', groupId),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    } catch (error) {
        captureError(error, { context: 'getReservationsByGroupId', groupId, orgId });
        throw error;
    }
};

// ─── 그룹 일괄 액션 헬퍼 ───

/** 그룹 내 활성 예약을 조회하여 일괄 batch 액션(update/delete)을 실행하는 공용 헬퍼 */
const batchGroupAction = async (
    fetchFn: (id: string, orgId: string) => Promise<Reservation[]>,
    action: 'cancel' | 'delete',
    id: string,
    orgId: string,
    context: string,
) => {
    try {
        const reservations = await fetchFn(id, orgId);
        const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
        const batch = writeBatch(db);
        active.forEach(r => {
            if (action === 'cancel') {
                batch.update(reservationDoc(r.id), { status: 'cancelled' });
            } else {
                batch.delete(reservationDoc(r.id));
            }
        });
        await batch.commit();
        return active.length;
    } catch (error) {
        captureError(error, { context, id, orgId });
        throw error;
    }
};

// 연속 예약 그룹 일괄 취소
export const cancelReservationGroup = (groupId: string, orgId: string) =>
    batchGroupAction(getReservationsByGroupId, 'cancel', groupId, orgId, 'cancelReservationGroup');

// 연속 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteReservationGroup = (groupId: string, orgId: string) =>
    batchGroupAction(getReservationsByGroupId, 'delete', groupId, orgId, 'deleteReservationGroup');

// 내 최근 예약 조회 (취소 제외, 최신 순 정렬하여 반환)
// 복합 인덱스: organizationId + reservedByUid + date (firestore.indexes.json)
// orderBy 없이 클라이언트 메모리에서 정렬 처리
export const getMyRecentReservations = async (orgId: string, uid: string, limitCount = 50) => {
    try {
        // 최근 3개월치만 조회하여 Firestore 읽기 비용 절감
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const sinceStr = threeMonthsAgo.toISOString().slice(0, 10);
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('reservedByUid', '==', uid),
            where('date', '>=', sinceStr),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled')
            .sort((a, b) => ((b.date || '') + (b.startTime || '')).localeCompare((a.date || '') + (a.startTime || '')))
            .slice(0, limitCount);
    } catch (error) {
        captureError(error, { context: 'getMyRecentReservations', orgId, uid });
        throw error;
    }
};

// ─── 반복(정기) 예약 그룹 관련 ───

// recurringGroupId로 반복 예약 그룹 조회
export const getReservationsByRecurringGroupId = async (recurringGroupId: string, orgId: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('recurringGroupId', '==', recurringGroupId),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    } catch (error) {
        captureError(error, { context: 'getReservationsByRecurringGroupId', recurringGroupId, orgId });
        throw error;
    }
};

// 반복 예약 그룹 일괄 취소
export const cancelRecurringGroup = (recurringGroupId: string, orgId: string) =>
    batchGroupAction(getReservationsByRecurringGroupId, 'cancel', recurringGroupId, orgId, 'cancelRecurringGroup');

// 반복 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteRecurringGroup = (recurringGroupId: string, orgId: string) =>
    batchGroupAction(getReservationsByRecurringGroupId, 'delete', recurringGroupId, orgId, 'deleteRecurringGroup');

