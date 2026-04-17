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
import type { User } from '../../types/user';
import { createZodConverter, userSchema } from '../../schemas';
import { captureError } from '../sentry';

const userConverter = createZodConverter(userSchema);

// 사용자 조회
export const getUser = async (uid: string) => {
    try {
        const snap = await getDoc(doc(db, 'users', uid).withConverter(userConverter));
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        captureError(error, { context: 'getUser', uid });
        throw error;
    }
};

// 사용자 생성
export const createUser = async (uid: string, data: Partial<User>) => {
    try {
        await setDoc(doc(db, 'users', uid), {
            ...data,
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error, { context: 'createUser', uid, data });
        throw error;
    }
};

// 기관 나가기 (사용자 문서 삭제 → onSnapshot이 감지 → 초대 코드 화면)
export const leaveOrganization = async (uid: string) => {
    try {
        await deleteDoc(doc(db, 'users', uid));
    } catch (error) {
        captureError(error, { context: 'leaveOrganization', uid });
        throw error;
    }
};

// 사용자 정보 수정
export const updateUser = async (uid: string, data: Partial<User>) => {
    // updateUser의 경우 data의 일부 필드만 수정될 수 있으므로 Converter를 씌우지 않거나, 
    // updateDoc 파라미터로 그대로 사용하되 타입 제한을 Partial<User>로 제한합니다.
    try {
        await updateDoc(doc(db, 'users', uid), data);
    } catch (error) {
        captureError(error, { context: 'updateUser', uid, data });
        throw error;
    }
};

// 기관 소속 직원 목록 조회
export const getOrganizationMembers = async (orgId: string) => {
    try {
        const q = query(
            collection(db, 'users').withConverter(userConverter),
            where('organizationId', '==', orgId)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getOrganizationMembers', orgId });
        throw error;
    }
};

// 전체 기관별 유효 멤버 수 조회 (미활성 기관 판별용)
export const getOrgMemberCounts = async (): Promise<Record<string, number>> => {
    try {
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
    } catch (error) {
        captureError(error, { context: 'getOrgMemberCounts' });
        throw error;
    }
};
