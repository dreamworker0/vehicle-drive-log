import { z } from 'zod';
import type { VehicleType, FuelType } from '../types/vehicle';
import type { TimestampField } from '../types/common';

// Firebase Timestamp/Date 혼용 타입
export const timestampSchema = z.custom<TimestampField | Date>((val) => val != null);

export const vehicleRetiredSchema = z.object({
    isRetired: z.boolean().catch(false),
    reason: z.string().catch(''),
    retiredAt: timestampSchema,
});

export const vehicleMaintenanceSchema = z.object({
    isBlocked: z.boolean().catch(false),
    reason: z.string().catch(''),
    endDate: z.string().nullable().catch(null),
    recordId: z.string().catch(''),
    blockedAt: timestampSchema,
});

export const vehicleSchema = z.object({
    organizationId: z.string().catch(''),
    name: z.string().catch(''),
    displayName: z.string().optional().catch(undefined),
    modelName: z.string().min(1, '모델명을 입력해주세요'),
    plateNumber: z.string().catch('번호 없음'),
    type: z.custom<VehicleType>().catch('car' as VehicleType),
    vehicleType: z.string().optional().catch(undefined),
    fuelType: z.custom<FuelType>().optional().catch(undefined),
    currentKm: z.coerce.number().catch(0),
    insurance: z.object({
        company: z.string().catch(''),
        phone: z.string().catch(''),
    }).optional().nullable().catch(null),
    hipassCardNumber: z.string().optional().nullable().catch(null),
    googleCalendarId: z.string().optional().nullable().catch(null),
    retired: vehicleRetiredSchema.nullable().optional().catch(null),
    maintenance: vehicleMaintenanceSchema.nullable().optional().catch(null),
    createdAt: timestampSchema.optional().nullable().catch(null),
});
