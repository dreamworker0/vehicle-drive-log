/**
 * Firestore — 사용자 (Users) 관련 함수
 */
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// 사용자 조회
export const getUser = async (uid) => {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// 사용자 생성
export const createUser = async (uid, data) => {
    await setDoc(doc(db, 'users', uid), {
        ...data,
        createdAt: serverTimestamp(),
    });
};

// 기관 나가기 (사용자 문서 삭제 → onSnapshot이 감지 → 초대 코드 화면)
export const leaveOrganization = async (uid) => {
    await deleteDoc(doc(db, 'users', uid));
};

// 사용자 정보 수정
export const updateUser = async (uid, data) => {
    await updateDoc(doc(db, 'users', uid), data);
};

// 기관 소속 직원 목록 조회
export const getOrganizationMembers = async (orgId) => {
    const q = query(
        collection(db, 'users'),
        where('organizationId', '==', orgId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};
