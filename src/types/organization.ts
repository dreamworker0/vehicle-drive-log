/**
 * 기관 (Organizations) 타입
 *
 * 문서 모양의 원본은 `src/schemas/organization.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { organizationSchema, orgStatusSchema, withdrawReasonSchema } from '../schemas/organization';
import type { FirestoreDoc } from './common';

export type OrgStatus = z.infer<typeof orgStatusSchema>;

/** 기관 탈퇴(서비스 해지) 사유 */
export type WithdrawReason = z.infer<typeof withdrawReasonSchema>;

/** 탈퇴 사유 코드 → 한글 라벨 */
export const WITHDRAW_REASON_LABELS: Record<WithdrawReason, string> = {
    no_longer_needed: '서비스가 더 이상 필요 없음',
    too_difficult: '사용이 어려움',
    missing_features: '필요한 기능 부족',
    other: '기타',
};

export type Organization = z.infer<typeof organizationSchema> & FirestoreDoc;

/** createOrganization에 전달할 데이터 */
export type CreateOrgData = Omit<Organization, 'id' | 'status' | 'createdAt' | 'approvedAt' | 'rejectedAt' | 'deletedAt' | 'inviteCode'>;
