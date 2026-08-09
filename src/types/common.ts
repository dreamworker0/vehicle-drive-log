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

/**
 * 쓰기 페이로드 타입 — 지정한 시각 필드에 `serverTimestamp()`를 넣을 수 있게 넓힌다.
 *
 * 도메인 타입(읽기)의 시각 필드는 `FirestoreTimestamp`(Timestamp | Date)다. `FieldValue`는
 * **읽을 때 절대 돌아오지 않는 값**이라 읽기 타입에 섞으면, 화면에서 `toDate()`를 부를 때마다
 * "FieldValue에는 toDate가 없다"는 이유로 캐스팅이 필요해진다. 그 대신 서버 시각을 심는
 * 쓰기 지점에서만 이 타입으로 넓힌다.
 */
export type WithServerTimestamps<T, K extends keyof T> = Omit<T, K> & { [P in K]?: TimestampField };
