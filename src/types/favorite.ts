/**
 * 즐겨찾기 (Favorites) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface Favorite extends FirestoreDoc {
    userId: string;
    name: string;        // 추가
    destination: string;
    address?: string;
    purpose?: string;
    organizationId?: string; // 추가
    createdAt?: TimestampField;
}
