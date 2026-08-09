/**
 * 차량 정비 (Maintenance) 타입
 *
 * 문서 모양의 원본은 `src/schemas/maintenance.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { maintenanceSchema } from '../schemas/maintenance';
import type { FirestoreDoc } from './common';

export type MaintenanceRecord = z.infer<typeof maintenanceSchema> & FirestoreDoc;

/** createMaintenanceRecord에 전달할 데이터 */
export type CreateMaintenanceData = Omit<MaintenanceRecord, 'id' | 'createdAt'>;
