import { z } from 'zod';
import { timestampSchema } from './index';

export const orgStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deleted']);

export const organizationSchema = z.object({
    id: z.string(),
    name: z.string(),
    address: z.string().optional(),
    phone: z.string().optional(),
    representativeName: z.string().optional(),
    adminEmail: z.string().optional(),
    applicantUid: z.string(),
    applicantEmail: z.string().optional(),
    applicantName: z.string().optional(),
    applicantPhone: z.string().optional(),
    message: z.string().optional(),
    approvalLine: z.array(z.object({ title: z.string() })).optional(),
    hideApprovalLine: z.boolean().optional(),
    requireReservationApproval: z.boolean().optional(),
    status: orgStatusSchema,
    inviteCode: z.string().optional(),
    uniqueNumber: z.string().optional(),
    uniqueNumberImageUrl: z.string().optional(),
    aiVerified: z.boolean().optional(),
    aiVerifyDetail: z.object({
        documentType: z.string().optional(),
        uniqueNumber: z.string().optional(),
        extractedName: z.string().optional(),
        nameMatch: z.boolean().optional(),
        address: z.string().optional(),
        rejected: z.boolean().optional(),
        reason: z.string().optional(),
    }).optional(),
    createdAt: timestampSchema.optional(),
    approvedAt: timestampSchema.optional(),
    rejectedAt: timestampSchema.optional(),
    deletedAt: timestampSchema.nullable().optional(),
    firstEmployeeRegisteredAt: timestampSchema.optional(),
    timeToFirstEmployeeDays: z.number().optional(),
});

export type OrganizationSchemaType = z.infer<typeof organizationSchema>;
