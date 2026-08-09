/**
 * 스키마 공통 요소
 *
 * `timestampSchema`가 schemas/vehicle.ts에 있어 다른 도메인 스키마가 **차량 스키마를 거쳐**
 * 시각 타입을 가져오는 구조였다(auditLog·broadcast는 순환 참조를 피하려 그렇게 했다는 주석까지
 * 달려 있었다). 도메인 스키마끼리 참조하지 않도록 공통 요소만 여기로 분리한다.
 *
 * ## 이 디렉터리가 문서 모양의 단일 원본이다
 * `src/types/`의 도메인 타입은 여기 스키마에서 `z.infer`로 파생된다. 필드를 추가할 때
 * 스키마만 고치면 타입이 따라오고, 스키마에서 빠뜨리면 타입에서도 사라져 **컴파일 에러로
 * 드러난다.** 예전처럼 인터페이스와 스키마를 각각 선언하면 `createZodConverter`가 Zod가
 * 모르는 키를 조용히 제거하는 탓에, 저장은 되는데 화면에서는 항상 undefined인 필드가
 * 컴파일 에러 없이 생긴다(실제로 차량 `currentBattery`·예약 `syncSource`가 그렇게 죽어 있었다).
 */
import { z } from 'zod';
import type { FirestoreTimestamp } from '../types/common';

/**
 * 읽어 온 시각 값 — Firestore Timestamp 또는 Date.
 *
 * `FieldValue`(serverTimestamp의 반환값)는 **일부러 넣지 않는다.** 쓰기에만 존재하고 읽을 때는
 * 절대 돌아오지 않는 값이라, 읽기 타입에 섞으면 화면에서 `toDate()`를 부를 때마다
 * "FieldValue에는 toDate가 없다"는 이유로 캐스팅이 필요해진다.
 * 서버 시각을 심는 쓰기 지점은 `WithServerTimestamps`로 해당 필드만 넓힌다.
 */
export const timestampSchema = z.custom<FirestoreTimestamp>((val) => val != null);
