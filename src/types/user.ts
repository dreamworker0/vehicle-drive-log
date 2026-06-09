/**
 * 사용자 (Users) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type UserRole = 'employee' | 'admin' | 'superAdmin';

export interface GoogleOauthData {
    accessToken: string;
    refreshToken: string;
    expiryDate: number; // Token 만료 Unix Timestamp (ms)
    email?: string;
}

export interface User extends FirestoreDoc {
    uid?: string;
    name: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
    organizationStatus?: string;
    theme?: 'light' | 'dark';
    status?: 'active' | 'disabled';
    photoURL?: string;
    phone?: string;
    welcomeDismissed?: boolean;
    createdAt?: TimestampField;
    disabledAt?: TimestampField;
    promotedAt?: TimestampField;
    fcmToken?: string;
    googleOauth?: GoogleOauthData;
}

/** createUser에 전달할 데이터 (id, createdAt 제외) */
export type CreateUserData = Omit<User, 'id' | 'createdAt'>;
