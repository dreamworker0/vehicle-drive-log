import { z } from 'zod';
import { timestampSchema } from './index';

export const userRoleSchema = z.enum(['employee', 'admin', 'superAdmin']);

export const userSchema = z.object({
    id: z.string(),
    uid: z.string().optional(),
    name: z.string(),
    email: z.string(),
    role: userRoleSchema,
    organizationId: z.string().nullable(),
    organizationStatus: z.string().optional(),
    status: z.enum(['active', 'disabled']).optional(),
    photoURL: z.string().optional(),
    phone: z.string().optional(),
    createdAt: timestampSchema.optional(),
    disabledAt: timestampSchema.optional(),
    promotedAt: timestampSchema.optional(),
});

export type UserSchemaType = z.infer<typeof userSchema>;
