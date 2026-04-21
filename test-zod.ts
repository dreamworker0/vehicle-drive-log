import { z } from 'zod';

const userRoleSchema = z.enum(['employee', 'admin', 'superAdmin']);

export const timestampSchema = z.custom((val) => val != null);

export const userSchema = z.object({
    id: z.string().catch(''),
    uid: z.string().optional().catch(''),
    name: z.string().catch('-'),
    email: z.string().catch(''),
    role: userRoleSchema.catch('employee'),
    organizationId: z.string().nullable().catch(null),
    organizationStatus: z.string().optional().catch(''),
    theme: z.enum(['light', 'dark']).optional().catch(undefined),
    status: z.enum(['active', 'disabled']).optional().catch('active'),
    photoURL: z.string().optional().catch(''),
    phone: z.string().optional().catch(''),
    welcomeDismissed: z.boolean().optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    disabledAt: timestampSchema.optional().catch(undefined),
    promotedAt: timestampSchema.optional().catch(undefined),
});

const data = {
    createdAt: new Date(),
    email: "kjyy950922@gmail.com",
    name: "강예준",
    organizationId: "TYiuOiHhr0Rs5FiiQrVH",
    phone: "",
    role: "admin"
};

const result = userSchema.safeParse(data);
console.log(JSON.stringify(result, null, 2));
