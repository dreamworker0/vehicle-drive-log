/**
 * 기관 (Organizations) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type OrgStatus = 'pending' | 'approved' | 'rejected' | 'deleted';

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
    firstEmployeeRegisteredAt?: TimestampField;
    timeToFirstEmployeeDays?: number;
}

/** createOrganization에 전달할 데이터 */
export type CreateOrgData = Omit<Organization, 'id' | 'status' | 'createdAt' | 'approvedAt' | 'rejectedAt' | 'deletedAt' | 'inviteCode'>;
