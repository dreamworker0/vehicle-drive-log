import { z } from 'zod';
import { timestampSchema } from './vehicle';
import type { ReservationStatus } from '../types/reservation';

export const reservationSchema = z.object({
    organizationId: z.string(),
    vehicleId: z.string(),
    vehicleName: z.string().optional(),
    vehicleDisplayName: z.string().optional(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    actualStartTime: z.string().optional(),
    actualEndTime: z.string().optional(),
    purpose: z.string().optional(),
    destination: z.string().optional(),
    reservedByUid: z.string(),
    reservedByName: z.string().optional(),
    status: z.custom<ReservationStatus>(),
    rejectedReason: z.string().optional(),
    routeDistance: z.number().nullable().optional(),
    routeDuration: z.number().nullable().optional(),
    routeTollFee: z.number().nullable().optional(),
    groupId: z.string().optional(),
    recurringGroupId: z.string().optional(),
    isQuickDrive: z.boolean().optional(),
    source: z.string().optional(),
    createdAt: timestampSchema.optional(),
    expiresAt: timestampSchema.optional(),
});

