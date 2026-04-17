import { z } from 'zod';
import { timestampSchema } from './vehicle';
import type { ReservationStatus } from '../types/reservation';

export const reservationSchema = z.object({
    organizationId: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().nullish().catch(null),
    vehicleDisplayName: z.string().nullish().catch(null),
    date: z.string().catch(''),
    startTime: z.string().catch(''),
    endTime: z.string().catch(''),
    actualStartTime: z.string().nullish().catch(null),
    actualEndTime: z.string().nullish().catch(null),
    purpose: z.string().nullish().catch(null),
    destination: z.string().nullish().catch(null),
    reservedByUid: z.string().catch(''),
    reservedByName: z.string().nullish().catch(null),
    status: z.custom<ReservationStatus>().catch('pending' as ReservationStatus),
    rejectedReason: z.string().nullish().catch(null),
    routeDistance: z.coerce.number().nullable().optional().catch(null),
    routeDuration: z.coerce.number().nullable().optional().catch(null),
    routeTollFee: z.coerce.number().nullable().optional().catch(null),
    groupId: z.string().nullish().catch(null),
    recurringGroupId: z.string().nullish().catch(null),
    isQuickDrive: z.boolean().nullish().catch(null),
    source: z.string().nullish().catch(null),
    createdAt: timestampSchema.optional().catch(undefined),
    expiresAt: timestampSchema.optional().catch(undefined),
});

