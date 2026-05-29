/**
 * Firestore — 사용자 (Users) 관련 함수
 */
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs, getCountFromServer,
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
            theme: 'dark',
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
export const getOrgMemberCounts = async (orgIds?: string[]): Promise<Record<string, number>> => {
    try {
        const counts: Record<string, number> = {};
        
        if (!orgIds) {
            console.warn('[getOrgMemberCounts] orgIds 파라미터 없이 호출됨. 전체 users 조회가 발생하여 Firestore Read 비용이 높을 수 있습니다.');
            const snap = await getDocs(collection(db, 'users'));
            snap.docs.forEach(d => {
                const data = d.data();
                const orgId = data.organizationId;
                if (!orgId) return;
                if (!counts[orgId]) counts[orgId] = 0;
                if (data.name && data.name !== '-') {
                    counts[orgId]++;
                }
            });
            return counts;
        }

        if (orgIds.length === 0) return counts;

        // 기관별로 getCountFromServer 병렬 수행 (개별 문서 읽기 없이 인덱스 스캔만 수행)
        // note: name != '-' 조건은 복합 인덱스 필요 → organizationId 단일 조건으로 조회 후 클라이언트 필터링
        await Promise.all(
            orgIds.map(async (orgId) => {
                const q = query(
                    collection(db, 'users'),
                    where('organizationId', '==', orgId)
                );
                const snap = await getCountFromServer(q);
                counts[orgId] = snap.data().count;
            })
        );
        
        return counts;
    } catch (error) {
        captureError(error, { context: 'getOrgMemberCounts' });
        throw error;
    }
};

// 사용자 계정 활성화 복원
export const restoreUser = async (uid: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'users', uid), { status: 'active', disabledAt: null });
    } catch (error) {
        captureError(error, { context: 'restoreUser', uid });
        throw error;
    }
};

// 사용자의 기관 정보 초기화 (기관 이동 준비)
export const clearUserOrganization = async (uid: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'users', uid), {
            organizationId: null,
            role: 'employee',
        });
    } catch (error) {
        captureError(error, { context: 'clearUserOrganization', uid });
        throw error;
    }
};
