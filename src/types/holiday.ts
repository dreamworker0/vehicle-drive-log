/**
 * 커스텀 휴일 (Custom Holidays) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface CustomHoliday extends FirestoreDoc {
    date: string;              // 'YYYY-MM-DD'
    name: string;
    createdAt?: TimestampField;
}
