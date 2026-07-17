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
    // ── 기능 사용 토글(미설정=켜짐). resolveOrgFeatures로 해석 ──
    /** 하이패스 사용(운행일지 하이패스 입력 + 차량관리 하이패스 탭 + 관리자 하이패스 관리) */
    hipassEnabled?: boolean;
    /** 수리·정비 사용(차량관리 정비 탭 + 관리자 정비 기록) */
    maintenanceEnabled?: boolean;
    /** 수리·정비를 일반 직원도 사용(미설정=허용). 끄면 관리자만 정비 기록 */
    maintenanceEmployeeAccess?: boolean;
    /** 차량별 사용 가능 직원 지정(차량 등록 폼 노출, 미설정=사용) */
    allowedUsersEnabled?: boolean;
    /** Google 캘린더 연동(차량 등록 폼 노출, 미설정=사용) */
    googleCalendarEnabled?: boolean;
    /** 운행일지 대표 운전자 지정(변경) 사용 */
    driverSelectionEnabled?: boolean;
    /** 운행일지 공동 운전자 사용 */
    coDriverEnabled?: boolean;
    /** 운행일지 동승자 기록 사용 */
    passengerEnabled?: boolean;
    // ── 입력 방식 개별 활성화(미설정=켜짐). 최소 1개는 유지 ──
    /** 동승자: 직원 목록에서 직접 선택 */
    passengerAllowList?: boolean;
    /** 동승자: 검색으로 선택(이름 직접 입력) */
    passengerAllowSearch?: boolean;
    /** 동승자: 인원 숫자만 입력 */
    passengerAllowCount?: boolean;
    /** 운전자(대표·공동): 직원 목록에서 직접 선택 */
    driverAllowList?: boolean;
    /** 운전자(대표·공동): 검색으로 선택. 목록·검색 둘 다 켜지면 후보 8명 기준 자동 전환 */
    driverAllowSearch?: boolean;
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
