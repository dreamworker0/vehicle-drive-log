/**
 * Firestore — 사전 등록 직원 (preRegistered) 관련 함수
 */
import {
    collection, addDoc, getDocs, deleteDoc, doc,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';

export interface PreRegisteredEmployee {
    id: string;
    name: string;
    email: string;
    createdAt: unknown;
}

// 사전 등록 직원 목록 조회
export const getPreRegisteredEmployees = async (orgId: string): Promise<PreRegisteredEmployee[]> => {
    try {
        const snap = await getDocs(collection(db, 'organizations', orgId, 'preRegistered'));
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() } as PreRegisteredEmployee))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (error) {
        captureError(error, { context: 'getPreRegisteredEmployees', orgId });
        throw error;
    }
};

// 사전 등록 직원 추가
export const addPreRegisteredEmployee = async (
    orgId: string,
    name: string,
    email: string,
): Promise<void> => {
    try {
        await addDoc(collection(db, 'organizations', orgId, 'preRegistered'), {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error, { context: 'addPreRegisteredEmployee', orgId });
        throw error;
    }
};

// 사전 등록 직원 삭제
export const deletePreRegisteredEmployee = async (orgId: string, preRegId: string): Promise<void> => {
    try {
        await deleteDoc(doc(db, 'organizations', orgId, 'preRegistered', preRegId));
    } catch (error) {
        captureError(error, { context: 'deletePreRegisteredEmployee', orgId, preRegId });
        throw error;
    }
};
