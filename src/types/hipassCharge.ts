/**
 * 하이패스 충전 기록 (HipassCharges) 타입
 *
 * 문서 모양의 원본은 `src/schemas/hipassCharge.ts`다 — 여기서는 파생만 한다.
 * 필드 설명·주석도 스키마 쪽에 둔다(스키마를 고치면서 주석을 놓치는 일이 없도록).
 */
import type { z } from 'zod';
import type { hipassChargeSchema } from '../schemas/hipassCharge';
import type { FirestoreDoc } from './common';

export type HipassCharge = z.infer<typeof hipassChargeSchema> & FirestoreDoc;

/** createHipassCharge에 전달할 데이터 */
export type CreateHipassChargeData = Omit<HipassCharge, 'id' | 'createdAt'>;
