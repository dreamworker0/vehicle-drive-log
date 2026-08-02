import { z } from 'zod';
// 배럴(./index)이 이 파일을 re-export하므로 './index'에서 가져오면 순환 참조가 된다.
// 다른 스키마 파일(driveLog 등)과 같이 정의 파일에서 직접 가져온다.
import { timestampSchema } from './vehicle';

export const auditActionSchema = z.enum(['create', 'update', 'delete', 'login', 'export', 'read']);
export const auditTargetTypeSchema = z.enum(['driveLog', 'user', 'session', 'export', 'orgDocument']);
export const auditActorSourceSchema = z.enum(['stamp', 'auth', 'document', 'unknown']);

/**
 * 접속기록/변경 로그 스키마
 *
 * createZodConverter의 fromFirestore는 Zod가 모르는 키를 조용히 제거하므로,
 * 필드를 추가할 때 types/auditLog.ts와 반드시 함께 갱신해야 한다.
 * (organizations.consent를 스키마에 빠뜨려 저장은 되고 조회는 안 되는 결함을 겪었다.)
 *
 * at·expiresAt은 트리거가 **항상** 쓰므로 필수로 둔다. optional로 두면 AuditLog 타입과
 * 상호 대입이 안 되어 조회 화면(Phase 3)에서 캐스팅이 끼어든다.
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
    /** 접속지 IP·접속 환경 — 로그인 세션 기록(recordSession)에만 있다 */
    ip: z.string().nullable().optional().catch(undefined),
    userAgent: z.string().optional().catch(undefined),
    /** 반출 기록(recordExport)에만 있다 — 형식·대상·건수만 남기고 내용은 남기지 않는다 */
    exportFormat: z.string().optional().catch(undefined),
    exportDataset: z.string().optional().catch(undefined),
    recordCount: z.number().optional().catch(undefined),
    at: timestampSchema,
    expiresAt: timestampSchema,
});

export type AuditLogSchemaType = z.infer<typeof auditLogSchema>;
