/**
 * 주유 기록 (Fuel Logs) 타입
 *
 * 문서 모양의 원본은 `src/schemas/fuelLog.ts`다 — 여기서는 파생만 한다.
 * 예전 선언에 있던 `[key: string]: unknown`은 넣지 않는다 — 오타 프로퍼티 접근이
 * 컴파일 에러로 잡히지 않아 strict 모드의 효과를 상쇄했다.
 */
import type { z } from 'zod';
import type { fuelLogSchema } from '../schemas/fuelLog';
import type { FirestoreDoc } from './common';

export type FuelLog = z.infer<typeof fuelLogSchema> & FirestoreDoc;

/** createFuelLog에 전달할 데이터 */
export type CreateFuelLogData = Omit<FuelLog, 'id' | 'createdAt'>;
