/**
 * roles — 사용자 역할 (프론트엔드 · Cloud Functions 공용 원본)
 *
 * 역할 목록이 프론트 Zod 스키마(src/schemas/user.ts)와 서버 Custom Claims 검증
 * (functions setCustomClaims)에 따로 적혀 있었다. 역할을 하나 더하거나 이름을 바꿀 때
 * 한쪽만 고치면, 화면에서는 보이는 역할이 서버에서 employee로 강등되는 식으로 갈라진다.
 *
 * Firestore Rules(firestore.rules)는 import를 할 수 없어 같은 목록을 따로 적는다 — 역할을
 * 바꿀 때는 그쪽도 함께 고친다.
 */
export const USER_ROLES = ['employee', 'admin', 'superAdmin'] as const;

export type UserRole = typeof USER_ROLES[number];

/** 시스템에 정의된 역할인지 — 문서에 예상 밖 값이 들어와도 권한으로 이어지지 않게 거른다 */
export function isUserRole(value: unknown): value is UserRole {
    return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
