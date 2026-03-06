/**
 * 피드백 (Feedbacks) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type FeedbackStatus = 'unread' | 'read' | 'resolved';

export interface Feedback extends FirestoreDoc {
    organizationId?: string;
    organizationName?: string;
    authorUid: string;
    authorName?: string;
    authorEmail?: string;
    userName?: string;
    userEmail?: string;
    category?: string;
    title?: string;
    content: string;
    imageUrls?: string[];
    message?: string; // FeedbackForm.tsx에서 사용하는 필드 대응
    status: FeedbackStatus;
    reply?: string;
    createdAt?: TimestampField;
}

export interface CreateFeedbackData {
    message: string;
    imageUrls: string[];
    userEmail: string;
    userName: string;
    organizationId: string;
}
