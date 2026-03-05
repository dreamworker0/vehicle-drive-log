/**
 * Firestore — 기관 (Organizations) 관련 함수
 */
import {
    doc, getDoc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp, writeBatch,
    onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

// ========================
// 초대 코드
// ========================

// 초대 코드 생성 (6자리 영숫자)
export const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// 초대 코드로 기관 찾기
export const findOrganizationByInviteCode = async (code) => {
    const q = query(
        collection(db, 'organizations'),
        where('inviteCode', '==', code),
        where('status', '==', 'approved'),
        limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// 초대 코드 재발급
export const regenerateInviteCode = async (orgId) => {
    const newCode = generateInviteCode();
    await updateDoc(doc(db, 'organizations', orgId), {
        inviteCode: newCode,
    });
    return newCode;
};

// ========================
// 기관 CRUD
// ========================

// 기관 생성
export const createOrganization = async (data) => {
    const docRef = await addDoc(collection(db, 'organizations'), {
        ...data,
        status: 'pending',
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 기관 조회
export const getOrganization = async (orgId) => {
    const snap = await getDoc(doc(db, 'organizations', orgId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// 기관 정보 수정
export const updateOrganization = async (orgId, data) => {
    await updateDoc(doc(db, 'organizations', orgId), data);
};

// 기관 Soft delete (30일 내 복구 가능)
export const deleteOrganization = async (orgId) => {
    await updateDoc(doc(db, 'organizations', orgId), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
    });
};

// 영구 삭제 (소속 사용자 + 기관 문서 완전 제거)
export const permanentDeleteOrganization = async (orgId) => {
    const usersQuery = query(
        collection(db, 'users'),
        where('organizationId', '==', orgId)
    );
    const usersSnap = await getDocs(usersQuery);
    const batch = writeBatch(db);
    usersSnap.docs.forEach(userDoc => {
        batch.delete(userDoc.ref);
    });
    batch.delete(doc(db, 'organizations', orgId));
    await batch.commit();
};

// 삭제된 기관 복구
export const restoreOrganization = async (orgId) => {
    await updateDoc(doc(db, 'organizations', orgId), {
        status: 'approved',
        deletedAt: null,
    });
};

// ========================
// 기관 상태별 조회 / 구독
// ========================

// 대기 중 기관 목록 조회
export const getPendingOrganizations = async () => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 대기 중 기관 실시간 구독 (사이드바 배지용)
export const subscribePendingOrganizations = (callback) => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(orgs);
    });
};

// 승인된 기관 실시간 구독
export const subscribeApprovedOrganizations = (callback) => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'approved'),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(orgs);
    });
};

// 거절된 기관 실시간 구독
export const subscribeRejectedOrganizations = (callback) => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'rejected'),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
        const orgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(orgs);
    });
};

// 거절된 기관 목록 조회
export const getRejectedOrganizations = async () => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'rejected'),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 삭제된 기관 목록 조회
export const getDeletedOrganizations = async () => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'deleted'),
        orderBy('deletedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 승인된 기관 목록 조회
export const getApprovedOrganizations = async () => {
    const q = query(
        collection(db, 'organizations'),
        where('status', '==', 'approved'),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ========================
// 기관 승인 / 거절
// ========================

// 기관 승인
export const approveOrganization = async (orgId) => {
    await updateDoc(doc(db, 'organizations', orgId), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        inviteCode: generateInviteCode(),
    });
};

// 기관 거절
export const rejectOrganization = async (orgId) => {
    await updateDoc(doc(db, 'organizations', orgId), {
        status: 'rejected',
        rejectedAt: new Date(),
    });
};
