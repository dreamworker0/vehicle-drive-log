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

const functions = getFunctions(app, 'asia-northeast3');

// 예약 ID로 단일 조회
export const getReservationById = async (reservationId: string) => {
    const snap = await getDoc(doc(db, 'reservations', reservationId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as DocumentData & { id: string };
};

// 예약 생성 (클라이언트 측)
export const createReservation = async (data: Record<string, unknown>, requireApproval: boolean = false) => {
    const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
    const docRef = await addDoc(collection(db, 'reservations'), {
        ...data,
        status: requireApproval ? 'pending' : 'reserved',
        createdAt: serverTimestamp(),
        expiresAt,
    });
    return docRef.id;
};

/** 서버 측 중복 검증 기반 예약 생성 (Cloud Function + Firestore Transaction) */
export const createReservationSafe = async (data: Record<string, unknown>) => {
    const callable = httpsCallable(functions, 'createReservationSafe', { timeout: 15000 });
    const result = await callable(data);
    return (result.data as { reservationId: string }).reservationId;
};

// 날짜별 예약 목록 조회
export const getReservations = async (orgId: string, date?: string) => {
    const constraints = [
        where('organizationId', '==', orgId),
    ];
    if (date) {
        constraints.push(where('date', '==', date));
    }
    const q = query(collection(db, 'reservations'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 예약 실시간 구독
export const subscribeReservations = (orgId: string, callback: (reservations: (DocumentData & { id: string })[]) => void) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
    );
    return onSnapshot(q, (snap) => {
        const reservations = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
        callback(reservations);
    });
};

// 승인 대기 중인 예약 실시간 구독
export const subscribePendingReservations = (orgId: string, callback: (reservations: (DocumentData & { id: string })[]) => void) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('status', '==', 'pending')
    );
    return onSnapshot(q, (snap) => {
        const reservations = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
        // 생성일 순으로 정렬 (가장 오래된 것이 위로 오게)
        reservations.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeA - timeB; // 오름차순
        });
        callback(reservations);
    });
};

// 예약 취소
export const cancelReservation = async (reservationId: string) => {
    await updateDoc(doc(db, 'reservations', reservationId), {
        status: 'cancelled',
    });
};

// 예약 정보 수정
export const updateReservation = async (reservationId: string, data: Record<string, unknown>) => {
    await updateDoc(doc(db, 'reservations', reservationId), data);
};

// 예약 상태 변경 (클라이언트 트랜잭션을 통한 동시성 제어 보호)
export const updateReservationStatus = async (
    reservationId: string, 
    status: string, 
    extraData: Record<string, unknown> = {},
    expectedCurrentStatus?: string
) => {
    const reservationRef = doc(db, 'reservations', reservationId);
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
};

// 오늘 예약 조회 (취소 제외)
export const getTodayReservations = async (orgId: string, date: string) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('date', '==', date),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string; status?: string; date?: string })
        .filter(r => r.status !== 'cancelled');
};

// 주간 예약 조회 (취소 제외)
export const getWeekReservations = async (orgId: string, startDate: string, endDate: string) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string; status?: string; date?: string })
        .filter(r => r.status !== 'cancelled' && (r.date ?? '') >= startDate && (r.date ?? '') <= endDate);
};

// 날짜 범위별 예약 조회 (getWeekReservations 별칭)
export const getReservationsByDateRange = getWeekReservations;

// groupId로 연속 예약 그룹 조회
// Firestore Rules가 organizationId 기반 접근 제어를 하므로 orgId 필터 필수
export const getReservationsByGroupId = async (groupId: string, orgId: string) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('groupId', '==', groupId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string; status?: string; date?: string })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

// 연속 예약 그룹 일괄 취소
export const cancelReservationGroup = async (groupId: string, orgId: string) => {
    const reservations = await getReservationsByGroupId(groupId, orgId);
    const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
    await Promise.all(
        active.map(r => updateDoc(doc(db, 'reservations', r.id), { status: 'cancelled' }))
    );
    return active.length;
};

// 연속 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteReservationGroup = async (groupId: string, orgId: string) => {
    const reservations = await getReservationsByGroupId(groupId, orgId);
    const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
    await Promise.all(
        active.map(r => deleteDoc(doc(db, 'reservations', r.id)))
    );
    return active.length;
};

// 내 최근 예약 조회 (취소 제외, 최신 순 정렬하여 반환)
// 복합 인덱스 생성을 피하기 위해 클라이언트 메모리에서 정렬 처리
export const getMyRecentReservations = async (orgId: string, uid: string, limitCount = 50) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('reservedByUid', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { 
            id: string; 
            status?: string; 
            date?: string; 
            startTime?: string;
            vehicleId?: string;
            vehicleName?: string;
            destination?: string;
         })
        .filter(r => r.status !== 'cancelled')
        .sort((a, b) => ((b.date || '') + (b.startTime || '')).localeCompare((a.date || '') + (a.startTime || '')))
        .slice(0, limitCount);
};

// ─── 반복(정기) 예약 그룹 관련 ───

// recurringGroupId로 반복 예약 그룹 조회
export const getReservationsByRecurringGroupId = async (recurringGroupId: string, orgId: string) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('recurringGroupId', '==', recurringGroupId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string; status?: string; date?: string })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
};

// 반복 예약 그룹 일괄 취소
export const cancelRecurringGroup = async (recurringGroupId: string, orgId: string) => {
    const reservations = await getReservationsByRecurringGroupId(recurringGroupId, orgId);
    const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
    await Promise.all(
        active.map(r => updateDoc(doc(db, 'reservations', r.id), { status: 'cancelled' }))
    );
    return active.length;
};

// 반복 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteRecurringGroup = async (recurringGroupId: string, orgId: string) => {
    const reservations = await getReservationsByRecurringGroupId(recurringGroupId, orgId);
    const active = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed');
    await Promise.all(
        active.map(r => deleteDoc(doc(db, 'reservations', r.id)))
    );
    return active.length;
};
