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
import type { TimestampField } from '../types/common';

/** Firebase Timestamp/Date/FieldValue 혼용 — 읽기(Timestamp)와 쓰기(serverTimestamp)를 모두 받는다 */
export const timestampSchema = z.custom<TimestampField>((val) => val != null);
