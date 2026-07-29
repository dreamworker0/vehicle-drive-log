import { z } from 'zod';
import { timestampSchema } from './index';

export const orgStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deleted']);
export const withdrawReasonSchema = z.enum(['no_longer_needed', 'too_difficult', 'missing_features', 'other']);

export const organizationSchema = z.object({
    id: z.string().catch(''),
    name: z.string().catch(''),
    address: z.string().optional().catch(undefined),
    phone: z.string().optional().catch(undefined),
    representativeName: z.string().optional().catch(undefined),
    adminEmail: z.string().optional().catch(undefined),
    applicantUid: z.string().catch(''),
    applicantEmail: z.string().optional().catch(undefined),
    applicantName: z.string().optional().catch(undefined),
    applicantPhone: z.string().optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    approvalLine: z.array(z.object({ title: z.string().catch('') })).optional().catch(undefined),
    hideApprovalLine: z.boolean().optional().catch(undefined),
    requireReservationApproval: z.boolean().optional().catch(undefined),
    hipassEnabled: z.boolean().optional().catch(undefined),
    maintenanceEnabled: z.boolean().optional().catch(undefined),
    maintenanceEmployeeAccess: z.boolean().optional().catch(undefined),
    allowedUsersEnabled: z.boolean().optional().catch(undefined),
    googleCalendarEnabled: z.boolean().optional().catch(undefined),
    driverSelectionEnabled: z.boolean().optional().catch(undefined),
    coDriverEnabled: z.boolean().optional().catch(undefined),
    passengerEnabled: z.boolean().optional().catch(undefined),
    passengerAllowList: z.boolean().optional().catch(undefined),
    passengerAllowSearch: z.boolean().optional().catch(undefined),
    passengerAllowCount: z.boolean().optional().catch(undefined),
    driverAllowList: z.boolean().optional().catch(undefined),
    driverAllowSearch: z.boolean().optional().catch(undefined),
    status: orgStatusSchema.catch('pending'),
    inviteCode: z.string().optional().catch(undefined),
    uniqueNumber: z.string().optional().catch(undefined),
    uniqueNumberImageUrl: z.string().optional().catch(undefined),
    uniqueNumberImagePath: z.string().optional().catch(undefined),
    aiVerified: z.boolean().optional().catch(undefined),
    aiVerifyDetail: z.object({
        documentType: z.string().optional().catch(undefined),
        uniqueNumber: z.string().optional().catch(undefined),
        extractedName: z.string().optional().catch(undefined),
        nameMatch: z.boolean().optional().catch(undefined),
        address: z.string().optional().catch(undefined),
        rejected: z.boolean().optional().catch(undefined),
        reason: z.string().optional().catch(undefined),
    }).optional().catch(undefined),
    /**
     * 약관·처리방침 동의 기록 (위탁 계약 성립 근거 — 약관 제9조).
     * 여기서 빠지면 createZodConverter의 fromFirestore가 unknown key를 조용히 제거해
     * (Zod z.object 기본 동작) Firestore에 저장돼 있어도 앱에서는 항상 undefined가 된다.
     * 저장만 되고 조회가 불가능해지므로 입증 자료로 쓸 수 없다.
     */
    consent: z.object({
        terms: z.boolean().catch(false),
        privacy: z.boolean().catch(false),
        termsVersion: z.string().catch(''),
        privacyVersion: z.string().catch(''),
        agreedAt: timestampSchema.optional().catch(undefined),
    }).optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    approvedAt: timestampSchema.optional().catch(undefined),
    rejectedAt: timestampSchema.optional().catch(undefined),
    deletedAt: timestampSchema.nullable().optional().catch(null),
    deletedBy: z.enum(['admin', 'superAdmin']).optional().catch(undefined),
    withdrawReason: withdrawReasonSchema.optional().catch(undefined),
    withdrawReasonDetail: z.string().optional().catch(undefined),
    firstEmployeeRegisteredAt: timestampSchema.optional().catch(undefined),
    timeToFirstEmployeeDays: z.number().optional().catch(undefined),
});

export type OrganizationSchemaType = z.infer<typeof organizationSchema>;
