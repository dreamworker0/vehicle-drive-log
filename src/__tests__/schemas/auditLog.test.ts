/**
 * auditLog 스키마 — 서버가 쓰는 값을 프론트가 그대로 읽는지 고정한다
 *
 * 이 테스트가 있는 이유: 스키마의 enum이 `.catch()`를 달고 있어 **모르는 값을 조용히
 * 다른 값으로 바꾼다**. 서버(writeAuditEntry)가 쓰는 `export`·`read`·`orgDocument`가
 * 스키마에 없던 동안 반출 기록은 조회 시 '운행일지 수정'으로 보였다.
 * 서버가 쓰는 값이 늘어나면 여기가 먼저 깨져야 한다.
 */
import { describe, it, expect } from 'vitest';
import { auditLogSchema } from '../../schemas/auditLog';

/** 서버가 실제로 쓰는 필드 조합 (functions/src/services/audit/writeAuditEntry.ts) */
const base = {
    id: 'doc-1',
    organizationId: 'org-1',
    targetId: 'target-1',
    actorUid: 'u1',
    actorSource: 'auth',
    subjectUids: [],
    at: { seconds: 1, nanoseconds: 0 },
    expiresAt: { seconds: 2, nanoseconds: 0 },
};

describe('auditLogSchema', () => {
    it('세션 기록(login/session)의 IP·접속 환경을 보존한다', () => {
        const parsed = auditLogSchema.parse({
            ...base,
            action: 'login',
            targetType: 'session',
            ip: '203.0.113.7',
            userAgent: 'Chrome / Android',
        });
        expect(parsed.action).toBe('login');
        expect(parsed.targetType).toBe('session');
        expect(parsed.ip).toBe('203.0.113.7');
        expect(parsed.userAgent).toBe('Chrome / Android');
    });

    it('반출 기록(export)을 다른 수행업무로 바꾸지 않고 형식·대상·건수를 보존한다', () => {
        const parsed = auditLogSchema.parse({
            ...base,
            action: 'export',
            targetType: 'export',
            exportFormat: 'excel',
            exportDataset: 'driveLogs',
            recordCount: 320,
        });
        expect(parsed.action).toBe('export');
        expect(parsed.targetType).toBe('export');
        expect(parsed.exportFormat).toBe('excel');
        expect(parsed.exportDataset).toBe('driveLogs');
        expect(parsed.recordCount).toBe(320);
    });

    it('증빙서류 열람(read/orgDocument)을 그대로 읽는다', () => {
        const parsed = auditLogSchema.parse({ ...base, action: 'read', targetType: 'orgDocument' });
        expect(parsed.action).toBe('read');
        expect(parsed.targetType).toBe('orgDocument');
    });

    it('변경 로그는 필드명만 남기고 값은 담지 않는다', () => {
        const parsed = auditLogSchema.parse({
            ...base,
            action: 'update',
            targetType: 'driveLog',
            changedFields: ['destination', 'passengerNames'],
        });
        expect(parsed.changedFields).toEqual(['destination', 'passengerNames']);
        // 값 필드는 스키마에 없으므로 파싱 결과에서 사라진다 (로그가 개인정보 사본이 되지 않는다)
        expect(Object.keys(parsed)).not.toContain('destination');
    });

    it('알 수 없는 수행업무는 update로 대체된다 — 서버 값 추가 시 이 테스트가 먼저 깨진다', () => {
        const parsed = auditLogSchema.parse({ ...base, action: 'teleport', targetType: 'driveLog' });
        expect(parsed.action).toBe('update');
    });
});
