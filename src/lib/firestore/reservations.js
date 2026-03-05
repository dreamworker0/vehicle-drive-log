/**
 * Firestore — 차량 예약 (Reservations) 관련 함수
 */
import {
    doc, updateDoc,
    collection, query, where, getDocs, addDoc,
    serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import app from '../firebase';

const functions = getFunctions(app, 'asia-northeast3');

// 예약 생성 (클라이언트 측)
export const createReservation = async (data) => {
    const docRef = await addDoc(collection(db, 'reservations'), {
        ...data,
        status: 'reserved',
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

/** 서버 측 중복 검증 기반 예약 생성 (Cloud Function + Firestore Transaction) */
export const createReservationSafe = async (data) => {
    const callable = httpsCallable(functions, 'createReservationSafe', { timeout: 15000 });
    const result = await callable(data);
    return result.data.reservationId;
};

// 날짜별 예약 목록 조회
export const getReservations = async (orgId, date) => {
    let constraints = [
        where('organizationId', '==', orgId),
    ];
    if (date) {
        constraints.push(where('date', '==', date));
    }
    const q = query(collection(db, 'reservations'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 예약 실시간 구독
export const subscribeReservations = (orgId, callback) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
    );
    return onSnapshot(q, (snap) => {
        const reservations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(reservations);
    });
};

// 예약 취소
export const cancelReservation = async (reservationId) => {
    await updateDoc(doc(db, 'reservations', reservationId), {
        status: 'cancelled',
    });
};

// 예약 정보 수정
export const updateReservation = async (reservationId, data) => {
    await updateDoc(doc(db, 'reservations', reservationId), data);
};

// 예약 상태 변경
export const updateReservationStatus = async (reservationId, status, extraData = {}) => {
    await updateDoc(doc(db, 'reservations', reservationId), {
        status,
        ...extraData,
    });
};

// 오늘 예약 조회 (취소 제외)
export const getTodayReservations = async (orgId, date) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('date', '==', date),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.status !== 'cancelled');
};

// 주간 예약 조회 (취소 제외)
export const getWeekReservations = async (orgId, startDate, endDate) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.status !== 'cancelled' && r.date >= startDate && r.date <= endDate);
};
