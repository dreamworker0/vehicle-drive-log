/**
 * 사용자 (Users) 타입
 *
 * 문서 모양의 원본은 `src/schemas/user.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { userSchema, userRoleSchema } from '../schemas/user';
import type { FirestoreDoc } from './common';

export type UserRole = z.infer<typeof userRoleSchema>;

export type User = z.infer<typeof userSchema> & FirestoreDoc;

/** createUser에 전달할 데이터 (id, createdAt 제외) */
export type CreateUserData = Omit<User, 'id' | 'createdAt'>;

/** 직원 목록 행의 가입 상태 */
export type MemberStatus = 'active' | 'pending' | 'disabled';

/**
 * 직원 관리 화면의 통합 목록 항목 (활성 + 가입대기 + 비활성).
 *
 * 문서가 아니라 화면 타입이므로 스키마에서 파생하지 않는다. 여기 두는 이유는
 * useEmployeeManager(생성)와 EmployeeListItem(소비)이 같은 모양을 각자 선언하고
 * 있었기 때문이다 — 컴포넌트 쪽이 original을 any로 두고 있어 콜백 6개가 전부
 * any를 타고 흘렀다. 한 곳에서 정의해 두 쪽이 어긋날 수 없게 한다.
 */
export interface UnifiedMember {
    id: string;
    name: string;
    email: string;
    role?: string;
    memberStatus: MemberStatus;
    /** 원본 사용자 문서 — 행의 동작(수정·삭제·역할 변경)은 이 값을 넘긴다 */
    original: User;
}
