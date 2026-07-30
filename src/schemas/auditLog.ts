import { z } from 'zod';
import { timestampSchema } from './index';

export const auditActionSchema = z.enum(['create', 'update', 'delete']);
export const auditTargetTypeSchema = z.enum(['driveLog', 'user']);
export const auditActorSourceSchema = z.enum(['document', 'unknown']);

/**
 * 접속기록/변경 로그 스키마
 *
 * createZodConverter의 fromFirestore는 Zod가 모르는 키를 조용히 제거하므로,
 * 필드를 추가할 때 types/auditLog.ts와 반드시 함께 갱신해야 한다.
 * (organizations.consent를 스키마에 빠뜨려 저장은 되고 조회는 안 되는 결함을 겪었다.)
 */
export const auditLogSchema = z.object({
    id: z.string().catch(''),
    organizationId: z.string().catch(''),
    action: auditActionSchema.catch('update'),
    targetType: auditTargetTypeSchema.catch('driveLog'),
    targetId: z.string().catch(''),
    actorUid: z.string().nullable().catch(null),
    actorSource: auditActorSourceSchema.catch('unknown'),
    subjectUids: z.array(z.string()).catch([]),
    changedFields: z.array(z.string()).optional().catch(undefined),
    at: timestampSchema.optional().catch(undefined),
    expiresAt: timestampSchema.optional().catch(undefined),
});

export type AuditLogSchemaType = z.infer<typeof auditLogSchema>;
