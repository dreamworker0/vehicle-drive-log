import { z } from 'zod';
import type { FuelType } from '../types/vehicle';
import { timestampSchema } from './vehicle';

/**
 * 주유·충전 기록 스키마.
 *
 * 이 도메인은 컨버터가 없어 `d.data() as Record<string, unknown>`으로 원시 캐스팅해
 * 반환했고, 호출부(useBaseFuelLog·useFuelLogAdmin)에서 다시 `as FuelLog[]`로 받았다.
 * 두 번의 캐스팅 사이에 실제 검증이 없어 타입은 선언일 뿐이었다.
 *
 * `.catch()` 폴백을 쓰는 이유는 다른 도메인과 같다 — 필드가 비거나 형식이 어긋난
 * 옛 문서 하나 때문에 목록 화면 전체가 깨지면 안 된다. 파싱 실패는 Sentry로 올라간다
 * (createZodConverter의 [Zod] 경고).
 */
export const fuelLogSchema = z.object({
    organizationId: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().optional().catch(undefined),
    driverUid: z.string().catch(''),
    driverName: z.string().optional().catch(undefined),
    date: z.string().catch(''),
    meterReading: z.coerce.number().catch(0),
    // types/fuelLog.ts의 선언(`meterPhotoUrl?: string`)에 맞춘다 — null을 허용하면
    // 타입과 스키마가 어긋나 호출부에서 다시 캐스팅이 필요해진다.
    meterPhotoUrl: z.string().optional().catch(undefined),
    fuelType: z.custom<FuelType>().optional().catch(undefined),
    fuelAmount: z.coerce.number().catch(0),
    fuelCost: z.coerce.number().catch(0),
    notes: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

export type FuelLogParsed = z.infer<typeof fuelLogSchema>;
