/**
 * Firestore 공통 타입
 */
import { Timestamp, FieldValue } from 'firebase/firestore';

/** Firestore Timestamp 또는 JS Date */
export type FirestoreTimestamp = Timestamp | Date;

/** serverTimestamp() 반환값(쓰기 시)과 Timestamp(읽기 시) 모두 허용 */
export type TimestampField = FirestoreTimestamp | FieldValue;

/** toDate()를 안전하게 호출할 수 있는 Timestamp-like 인터페이스 */
export interface TimestampLike {
    toDate(): Date;
    seconds: number;
    nanoseconds: number;
}

/** Firestore 문서 기본 필드 (id는 클라이언트에서 부여) */
export interface FirestoreDoc {
    id: string;
}
