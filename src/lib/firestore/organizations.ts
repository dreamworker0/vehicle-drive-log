/**
 * Firestore — 기관 (Organizations) 관련 함수
 */
import {
    doc, getDoc, updateDoc,
    collection, query, where, getDocs, addDoc, getCountFromServer,
    orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Organization } from '../../types/organization';
import { createZodConverter, organizationSchema } from '../../schemas';
import { captureError } from '../sentry';

const orgConverter = createZodConverter(organizationSchema);

// ========================
// 초대 코드
// ========================

// 초대 코드 생성 (6자리 영숫자)
export const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// 초대 코드로 기관 찾기
export const findOrganizationByInviteCode = async (code: string) => {
    try {
        const q = query(
            collection(db, 'organizations').withConverter(orgConverter),
            where('inviteCode', '==', code),
            where('status', '==', 'approved'),
            limit(1)
        );
        const snap = await getDocs(q);
        return snap.empty ? null : snap.docs[0].data();
    } catch (error) {
        captureError(error, { context: 'findOrganizationByInviteCode' });
        throw error;
    }
};

// 초대 코드 재발급
export const regenerateInviteCode = async (orgId: string) => {
    const newCode = generateInviteCode();
    try {
        await updateDoc(doc(db, 'organizations', orgId), {
            inviteCode: newCode,
        });
        return newCode;
    } catch (error) {
        captureError(error, { context: 'regenerateInviteCode', orgId });
        throw error;
    }
};

// ========================
// 기관 CRUD
// ========================

// 기관 생성
export const createOrganization = async (data: Partial<Organization>) => {
    try {
        const uniqueNumber = data.uniqueNumber || '';
        const cleanNumber = uniqueNumber.replace(/-/g, '');
        const isNonProfit = cleanNumber.length === 10 && cleanNumber.substring(3, 5) === '82';

        const status = isNonProfit ? 'approved' : 'pending';
        const inviteCode = isNonProfit ? generateInviteCode() : undefined;
        const approvedAt = isNonProfit ? serverTimestamp() : undefined;

        const docData: Partial<Organization> = {
            ...data,
            status,
            createdAt: serverTimestamp(),
        };
        
        if (inviteCode) docData.inviteCode = inviteCode;
        if (approvedAt) docData.approvedAt = approvedAt;

        const docRef = await addDoc(collection(db, 'organizations'), docData);
        return docRef.id;
    } catch (error) {
        captureError(error, { context: 'createOrganization', data });
        throw error;
    }
};

// 기관 조회
export const getOrganization = async (orgId: string) => {
    try {
        const snap = await getDoc(doc(db, 'organizations', orgId).withConverter(orgConverter));
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        captureError(error, { context: 'getOrganization', orgId });
        throw error;
    }
};

// 기관 정보 수정
export const updateOrganization = async (orgId: string, data: Partial<Organization>) => {
    try {
        await updateDoc(doc(db, 'organizations', orgId), data);
    } catch (error) {
        captureError(error, { context: 'updateOrganization', orgId, data });
        throw error;
    }
};

// 기관 Soft delete (30일 내 복구 가능)
// 소속 직원 문서도 함께 삭제 → 재로그인 시 초대 코드 화면으로 이동
export const deleteOrganization = async (orgId: string) => {
    try {
        const usersQuery = query(
            collection(db, 'users'),
            where('organizationId', '==', orgId)
        );
        const usersSnap = await getDocs(usersQuery);
        const batch = writeBatch(db);
        usersSnap.docs.forEach(userDoc => {
            batch.delete(userDoc.ref);
        });
        batch.update(doc(db, 'organizations', orgId), {
            status: 'deleted',
            deletedAt: serverTimestamp(),
        });
        await batch.commit();
    } catch (error) {
        captureError(error, { context: 'deleteOrganization', orgId });
        throw error;
    }
};

// 영구 삭제 (소속 사용자 + 기관 문서 완전 제거)
export const permanentDeleteOrganization = async (orgId: string) => {
    try {
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
    } catch (error) {
        captureError(error, { context: 'permanentDeleteOrganization', orgId });
        throw error;
    }
};

// 삭제된 기관 복구
export const restoreOrganization = async (orgId: string) => {
    try {
        await updateDoc(doc(db, 'organizations', orgId), {
            status: 'approved',
            deletedAt: null,
        });
    } catch (error) {
        captureError(error, { context: 'restoreOrganization', orgId });
        throw error;
    }
};

// ========================
// 기관 상태별 조회 / 구독
// ========================

// 대기 중 기관 모집 카운트
export const getPendingOrganizationsCount = async () => {
    try {
        const q = query(
            collection(db, 'organizations'),
            where('status', '==', 'pending')
        );
        const snap = await getCountFromServer(q);
        return snap.data().count;
    } catch (error) {
        captureError(error, { context: 'getPendingOrganizationsCount' });
        throw error;
    }
};

// 승인된 기관 모집 카운트
export const getApprovedOrganizationsCount = async () => {
    try {
        const q = query(
            collection(db, 'organizations'),
            where('status', '==', 'approved')
        );
        const snap = await getCountFromServer(q);
        return snap.data().count;
    } catch (error) {
        captureError(error, { context: 'getApprovedOrganizationsCount' });
        throw error;
    }
};

// 슈퍼관리자 상태별 목록 조회용 상한. 폭주 시 전체 풀스캔 방지 안전장치.
const ORG_LIST_LIMIT = 500;

// 대기 중 기관 목록 조회
export const getPendingOrganizations = async () => {
    try {
        const q = query(
            collection(db, 'organizations').withConverter(orgConverter),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc'),
            limit(ORG_LIST_LIMIT)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getPendingOrganizations' });
        throw error;
    }
};

// 거절된 기관 목록 조회
export const getRejectedOrganizations = async () => {
    try {
        const q = query(
            collection(db, 'organizations').withConverter(orgConverter),
            where('status', '==', 'rejected'),
            orderBy('createdAt', 'desc'),
            limit(ORG_LIST_LIMIT)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getRejectedOrganizations' });
        throw error;
    }
};

// 삭제된 기관 목록 조회
export const getDeletedOrganizations = async () => {
    try {
        const q = query(
            collection(db, 'organizations').withConverter(orgConverter),
            where('status', '==', 'deleted'),
            orderBy('deletedAt', 'desc'),
            limit(ORG_LIST_LIMIT)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getDeletedOrganizations' });
        throw error;
    }
};

// 승인된 기관 목록 조회
export const getApprovedOrganizations = async () => {
    try {
        const q = query(
            collection(db, 'organizations').withConverter(orgConverter),
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc'),
            limit(ORG_LIST_LIMIT)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getApprovedOrganizations' });
        throw error;
    }
};

// ========================
// 기관 승인 / 거절
// ========================

// 기관 승인
export const approveOrganization = async (orgId: string) => {
    try {
        await updateDoc(doc(db, 'organizations', orgId), {
            status: 'approved',
            approvedAt: serverTimestamp(),
            inviteCode: generateInviteCode(),
        });
    } catch (error) {
        captureError(error, { context: 'approveOrganization', orgId });
        throw error;
    }
};

// 기관 거절
export const rejectOrganization = async (orgId: string, reason?: string) => {
    try {
        const updateData: Record<string, unknown> = {
            status: 'rejected',
            rejectedAt: new Date(),
        };
        if (reason) {
            updateData.rejectReason = reason;
        }
        await updateDoc(doc(db, 'organizations', orgId), updateData);
    } catch (error) {
        captureError(error, { context: 'rejectOrganization', orgId });
        throw error;
    }
};
