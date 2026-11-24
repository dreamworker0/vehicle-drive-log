/**
 * 사용자 역할 — shared/roles.ts에서 re-export
 * 프론트 Zod 스키마와 서버 Claims 검증이 같은 목록을 쓴다.
 */
export { USER_ROLES, isUserRole } from "../../../shared/roles";
export type { UserRole } from "../../../shared/roles";
