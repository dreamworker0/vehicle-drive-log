import { z } from 'zod';
import type { VehicleType, FuelType } from '../types/vehicle';
import type { TimestampField } from '../types/common';

// Firebase Timestamp/Date 혼용 타입
export const timestampSchema = z.custom<TimestampField | Date>((val) => val != null);

export const vehicleRetiredSchema = z.object({
    isRetired: z.boolean(),
    reason: z.string(),
    retiredAt: timestampSchema,
});

export const vehicleMaintenanceSchema = z.object({
    isBlocked: z.boolean(),
    reason: z.string(),
    endDate: z.string().nullable(),
    recordId: z.string(),
    blockedAt: timestampSchema,
});

export const vehicleSchema = z.object({
    organizationId: z.string(),
    name: z.string(),
    displayName: z.string().optional(),
    modelName: z.string().optional(),
    plateNumber: z.string(),
    type: z.custom<VehicleType>(),
    vehicleType: z.string().optional(),
    fuelType: z.custom<FuelType>().optional(),
    currentKm: z.number(),
    insurance: z.object({
        company: z.string(),
        phone: z.string(),
    }).optional(),
    hipassCardNumber: z.string().optional(),
    googleCalendarId: z.string().optional(),
    retired: vehicleRetiredSchema.nullable().optional(),
    maintenance: vehicleMaintenanceSchema.nullable().optional(),
    createdAt: timestampSchema.optional(),
});
