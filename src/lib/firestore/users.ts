/**
 * Firestore — 사용자 (Users) 관련 함수
 */
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs,
    serverTimestamp,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

// 사용자 조회
export const getUser = async (uid: string) => {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// 사용자 생성
export const createUser = async (uid: string, data: Record<string, unknown>) => {
    await setDoc(doc(db, 'users', uid), {
        ...data,
        createdAt: serverTimestamp(),
    });
};

// 기관 나가기 (사용자 문서 삭제 → onSnapshot이 감지 → 초대 코드 화면)
export const leaveOrganization = async (uid: string) => {
    await deleteDoc(doc(db, 'users', uid));
};

// 사용자 정보 수정
export const updateUser = async (uid: string, data: Record<string, unknown>) => {
    await updateDoc(doc(db, 'users', uid), data);
};

// 기관 소속 직원 목록 조회
export const getOrganizationMembers = async (orgId: string) => {
    const q = query(
        collection(db, 'users'),
        where('organizationId', '==', orgId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 전체 기관별 유효 멤버 수 조회 (미활성 기관 판별용)
export const getOrgMemberCounts = async (): Promise<Record<string, number>> => {
    const snap = await getDocs(collection(db, 'users'));
    const counts: Record<string, number> = {};
    snap.docs.forEach(d => {
        const data = d.data();
        const orgId = data.organizationId;
        if (!orgId) return;
        if (!counts[orgId]) counts[orgId] = 0;
        // 이름이 있고 '-'가 아닌 사용자만 유효 멤버로 카운트
        if (data.name && data.name !== '-') {
            counts[orgId]++;
        }
    });
    return counts;
};
