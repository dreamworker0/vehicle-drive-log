/**
 * 사용자 (Users) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type UserRole = 'employee' | 'admin' | 'superAdmin';

export interface User extends FirestoreDoc {
    uid?: string;
    name: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
    organizationStatus?: string;
    photoURL?: string;
    createdAt?: TimestampField;
    promotedAt?: TimestampField;
}

/** createUser에 전달할 데이터 (id, createdAt 제외) */
export type CreateUserData = Omit<User, 'id' | 'createdAt'>;
