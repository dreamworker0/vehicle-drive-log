/**
 * Firestore — 슈퍼관리자 관리 관련 함수
 */
import {
    doc, updateDoc,
    collection, query, where, getDocs,
    limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

/** 전체 슈퍼관리자 목록 조회 */
export const getSuperAdmins = async () => {
    const q = query(
        collection(db, 'users'),
        where('role', '==', 'superAdmin')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
};

/** 이메일로 사용자 찾기 */
export const getUserByEmail = async (email: string) => {
    const q = query(
        collection(db, 'users'),
        where('email', '==', email),
        limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/** 슈퍼관리자 추가 (기존 users 문서의 role을 superAdmin으로) */
export const addSuperAdmin = async (email: string) => {
    const user = await getUserByEmail(email);
    if (!user) throw new Error('해당 이메일로 가입된 사용자가 없습니다. 먼저 앱에 로그인해야 합니다.');
    if ((user as Record<string, any>).role === 'superAdmin') throw new Error('이미 슈퍼관리자입니다.');
    await updateDoc(doc(db, 'users', user.id), {
        role: 'superAdmin',
        organizationId: null,
        promotedAt: serverTimestamp(),
    });
    return user;
};

/** 슈퍼관리자 제거 */
export const removeSuperAdmin = async (uid: string, currentAdminCount: number) => {
    if (currentAdminCount <= 1) throw new Error('최소 1명의 슈퍼관리자가 필요합니다.');
    await updateDoc(doc(db, 'users', uid), {
        role: 'employee',
        organizationId: null,
    });
};
