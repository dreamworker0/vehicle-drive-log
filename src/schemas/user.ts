import { z } from 'zod';
import { timestampSchema } from './index';

export const userRoleSchema = z.enum(['employee', 'admin', 'superAdmin']);

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
    /**
     * 이용약관 동의 기록 — joinOrganization(Admin SDK)만 기록한다.
     * 개인정보 동의는 받지 않으므로 privacy 항목이 없다(아래 types/user.ts 주석 참고).
     * 스키마에서 빠지면 createZodConverter가 unknown key를 조용히 제거해
     * 앱에서 항상 undefined가 되므로 반드시 함께 유지한다.
     */
    consent: z.object({
        terms: z.boolean().catch(false),
        termsVersion: z.string().catch(''),
        agreedAt: timestampSchema.optional().catch(undefined),
    }).optional().catch(undefined),
    /** 마지막 수정자 uid — Rules가 request.auth.uid와의 일치를 강제한다 */
    lastEditedByUid: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    disabledAt: timestampSchema.optional().catch(undefined),
    promotedAt: timestampSchema.optional().catch(undefined),
});

export type UserSchemaType = z.infer<typeof userSchema>;
