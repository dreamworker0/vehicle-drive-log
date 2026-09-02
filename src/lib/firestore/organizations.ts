/**
 * Firestore — 기관 (Organizations) 관련 함수
 */
import {
    doc, getDoc, updateDoc,
    collection, query, where, getDocs, addDoc, getCountFromServer,
    orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions } from '../firebase';
import type { Organization } from '../../types/organization';
import type { WithServerTimestamps } from '../../types/common';
import { createZodConverter, organizationSchema } from '../../schemas';
import { captureError } from '../sentry';

const orgConverter = createZodConverter(organizationSchema);

// ========================
// 초대 코드
// ========================

/**
 * 초대 코드 생성 (6자리, 암호학적 난수)
 *
 * 초대 코드는 기관 데이터 전체를 여는 사실상 단일 자격증명이다(합류 즉시 운행일지·직원
 * 연락처 열람, 관리자 없는 기관이면 admin 획득). `Math.random()`은 예측 가능한 PRNG라
 * 자격증명에 쓰지 않는다 — 2026-08-23 감사 부록 1.
 *
 * 알파벳은 서버 쪽 정본(`functions/src/utils/inviteCode.ts`)과 같아야 한다: 전화·문자로
 * 받아 적는 코드라 혼동 문자(0/O, 1/I)를 뺀 32자를 쓰고, 32는 2의 거듭제곱이라
 * 5비트 슬라이스(`& 31`)에 모듈로 편향이 없다.
 */
const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_CODE_LENGTH = 6;

export const generateInviteCode = () => {
    const bytes = new Uint8Array(INVITE_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
        code += INVITE_CODE_ALPHABET[bytes[i] & 31];
    }
    return code;
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

/**
 * 초대 코드 재발급 — 서버 콜러블로만 한다 (2026-09-02).
 *
 * 종전에는 여기서 난수를 만들어 `inviteCode`를 직접 썼다. 그러려면 Rules가 기관관리자에게
 * 그 필드를 열어 둬야 하고, 열어 두면 값을 고를 수 있다 — 다른 기관의 코드를 복사해 그 기관의
 * 신규 직원을 가로채는 경로가 된다. 지금은 Rules가 기관관리자의 `inviteCode` 쓰기를 막고,
 * `regenerateInviteCode` 콜러블이 서버 난수 + 중복 검사로 새 코드를 만든다.
 * 재시도(callWithRetry)를 걸지 않는다 — 부를 때마다 새 코드가 나오는 비멱등 호출이다.
 */
export const regenerateInviteCode = async (orgId: string) => {
    try {
        const call = httpsCallable<{ organizationId: string }, { inviteCode: string }>(
            firebaseFunctions,
            'regenerateInviteCode',
        );
        const result = await call({ organizationId: orgId });
        return result.data.inviteCode;
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

        // 쓰기 페이로드라 서버 시각(FieldValue)을 담을 수 있게 넓힌다 — 읽기 타입에는 없는 값이다
        const docData: WithServerTimestamps<Partial<Organization>, 'createdAt' | 'approvedAt'> = {
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
            deletedBy: 'superAdmin',
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

// 기관 승인 + 소속 관리자 상태를 원자적으로 갱신
// 기관 status/approvedAt/inviteCode 와 각 admin user의 organizationStatus 를 하나의 배치로
// 커밋해 "기관은 승인됐으나 관리자 상태는 미갱신"인 부분 실패를 방지한다.
// (인앱 알림·이메일·알림톡은 호출부에서 배치 밖 best-effort로 처리)
export const approveOrganizationWithAdmins = async (
    orgId: string,
    inviteCode: string,
    adminIds: string[],
) => {
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'organizations', orgId), {
            status: 'approved',
            approvedAt: serverTimestamp(),
            inviteCode,
        });
        adminIds.forEach(adminId => {
            batch.update(doc(db, 'users', adminId), { organizationStatus: 'approved' });
        });
        await batch.commit();
    } catch (error) {
        captureError(error, { context: 'approveOrganizationWithAdmins', orgId });
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
