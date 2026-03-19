/**
 * 알림 (Notifications) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface Notification extends FirestoreDoc {
    targetUid: string;
    title: string;
    message: string;
    type?: string;
    read: boolean;
    createdAt?: TimestampField;
}
