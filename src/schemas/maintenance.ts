import { z } from 'zod';
import { timestampSchema } from './vehicle';

/**
 * 차량 정비 기록 스키마.
 *
 * `blockVehicle`/`blockEndDate`는 차량 차단 상태를 좌우하므로 형식이 어긋난 값이
 * 조용히 통과하면 배차 가능 여부 판정이 흔들린다 — 폴백을 안전한 쪽(차단 안 함)으로 둔다.
 */
export const maintenanceSchema = z.object({
    organizationId: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().optional().catch(undefined),
    type: z.string().catch(''),
    description: z.string().optional().catch(undefined),
    cost: z.coerce.number().optional().catch(undefined),
    shop: z.string().optional().catch(undefined),
    km: z.coerce.number().optional().catch(undefined),
    nextDueKm: z.coerce.number().optional().catch(undefined),
    nextDueDate: z.string().optional().catch(undefined),
    date: z.string().catch(''),
    blockVehicle: z.boolean().catch(false),
    blockEndDate: z.string().nullable().catch(null),
    createdByUid: z.string().optional().catch(undefined),
    createdByName: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

export type MaintenanceParsed = z.infer<typeof maintenanceSchema>;
