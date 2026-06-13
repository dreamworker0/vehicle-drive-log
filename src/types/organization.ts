/**
 * 기관 (Organizations) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type OrgStatus = 'pending' | 'approved' | 'rejected' | 'deleted';

/** 기관 탈퇴(서비스 해지) 사유 */
export type WithdrawReason = 'no_longer_needed' | 'too_difficult' | 'missing_features' | 'other';

/** 탈퇴 사유 코드 → 한글 라벨 */
export const WITHDRAW_REASON_LABELS: Record<WithdrawReason, string> = {
    no_longer_needed: '서비스가 더 이상 필요 없음',
    too_difficult: '사용이 어려움',
    missing_features: '필요한 기능 부족',
    other: '기타',
};

export interface Organization extends FirestoreDoc {
    name: string;
    address?: string;
    phone?: string;
    representativeName?: string;
    adminEmail?: string;
    applicantUid: string;
    applicantEmail?: string;
    applicantName?: string;
    applicantPhone?: string;
    message?: string;
    approvalLine?: { title: string }[];
    hideApprovalLine?: boolean;
    requireReservationApproval?: boolean;
    status: OrgStatus;
    inviteCode?: string;
    uniqueNumber?: string;
    uniqueNumberImageUrl?: string;
    aiVerified?: boolean;
    aiVerifyDetail?: {
        documentType?: string;
        uniqueNumber?: string;
        extractedName?: string;
        nameMatch?: boolean;
        address?: string;
        rejected?: boolean;
        reason?: string;
    };
    createdAt?: TimestampField;
    approvedAt?: TimestampField;
    rejectedAt?: TimestampField;
    deletedAt?: TimestampField | null;
    /** 삭제(탈퇴) 주체 — 'admin'은 관리자 자발적 해지, 'superAdmin'은 운영자 정리 */
    deletedBy?: 'admin' | 'superAdmin';
    /** 자발적 탈퇴 사유 */
    withdrawReason?: WithdrawReason;
    /** 사유가 'other'일 때 자유 입력 상세 */
    withdrawReasonDetail?: string;
    firstEmployeeRegisteredAt?: TimestampField;
    timeToFirstEmployeeDays?: number;
    /** 지도 표시용 위도 */
    lat?: number;
    /** 지도 표시용 경도 */
    lng?: number;
}

/** createOrganization에 전달할 데이터 */
export type CreateOrgData = Omit<Organization, 'id' | 'status' | 'createdAt' | 'approvedAt' | 'rejectedAt' | 'deletedAt' | 'inviteCode'>;
