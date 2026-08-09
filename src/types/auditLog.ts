/**
 * 접속기록/변경 로그 (Audit Logs) 타입
 *
 * 문서 모양의 원본은 `src/schemas/auditLog.ts`다 — 여기서는 파생만 한다.
 * 법적 근거(개인정보 보호법 제29조 → 고시 제16조), 보관기간 1년 판단, 행위자 확정의
 * 한계 등 도메인 근거도 모두 스키마 파일 주석에 있다.
 */
import type { z } from 'zod';
import type {
    auditLogSchema,
    auditActionSchema,
    auditTargetTypeSchema,
    auditActorSourceSchema,
} from '../schemas/auditLog';
import type { FirestoreDoc } from './common';

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;
export type AuditActorSource = z.infer<typeof auditActorSourceSchema>;

export type AuditLog = z.infer<typeof auditLogSchema> & FirestoreDoc;
