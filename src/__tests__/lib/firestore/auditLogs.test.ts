/**
 * firestore/auditLogs 도메인 함수 단위 테스트
 *
 * 고정하는 계약:
 *  (1) 멀티테넌트 격리 — organizationId 필터 없이는 절대 조회하지 않는다
 *  (2) 유형 필터는 action `in` 하나로 처리한다 (인덱스가 1개면 충분한 근거)
 *  (3) 최신순 + 페이지 상한 + 커서 (점검 화면이 전량을 읽지 않게)
 *  (4) 직원 필터는 행위자 OR 대상으로 걸되, 기관 격리는 그 바깥 AND에 둔다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeRef = (label: string) => {
    const ref: { label: string; withConverter: (...a: unknown[]) => unknown } = {
        label,
        withConverter: () => ref,
    };
    return ref;
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, ...path: string[]) => makeRef(`col:${path.join('/')}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    and: vi.fn((...filters: unknown[]) => ({ _type: 'and', filters })),
    or: vi.fn((...filters: unknown[]) => ({ _type: 'or', filters })),
    startAfter: vi.fn((cursor: unknown) => ({ _type: 'startAfter', cursor })),
    getDocs: vi.fn(),
    Timestamp: {
        fromDate: (d: Date) => ({ _type: 'ts', millis: d.getTime() }),
    },
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: null }, firebaseFunctions: {} }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/sentry';
import {
    getAuditLogs, getAuditLogsForExport, AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_EXPORT_MAX,
    getAuditLogsByTargets, filterAuditLogs,
} from '../../../lib/firestore/auditLogs';
import type { AuditLog } from '../../../types/auditLog';

interface WhereConstraint { _type: string; field: string; op: string; value: unknown }

const snapOf = (rows: Array<Record<string, unknown>>) => ({
    docs: rows.map((row) => ({ id: row.id as string, data: () => row })),
});

/** 마지막 query() 호출의 제약 목록 */
const lastConstraints = () => {
    const calls = vi.mocked(fs.query).mock.calls;
    return calls[calls.length - 1].slice(1) as unknown as Array<Record<string, unknown>>;
};

const whereOn = (field: string) =>
    lastConstraints().filter((c) => c._type === 'where' && (c as unknown as WhereConstraint).field === field) as unknown as WhereConstraint[];

describe('firestore/auditLogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf([]) as never);
    });

    it('organizationId로 격리하고 최신순·페이지 상한으로 조회한다', async () => {
        await getAuditLogs('org-1');

        expect(whereOn('organizationId')).toEqual([
            { _type: 'where', field: 'organizationId', op: '==', value: 'org-1' },
        ]);
        expect(lastConstraints()).toContainEqual({ _type: 'orderBy', field: 'at', dir: 'desc' });
        expect(lastConstraints()).toContainEqual({ _type: 'limit', n: AUDIT_LOG_PAGE_SIZE });
    });

    it("유형 필터 없이는 action 조건을 걸지 않는다 (기본 인덱스로 처리)", async () => {
        await getAuditLogs('org-1', { kind: 'all' });
        expect(whereOn('action')).toHaveLength(0);
    });

    it('접속 유형은 login만, 변경 유형은 create·update·delete를 in으로 묶는다', async () => {
        await getAuditLogs('org-1', { kind: 'access' });
        expect(whereOn('action')).toEqual([
            { _type: 'where', field: 'action', op: 'in', value: ['login'] },
        ]);

        await getAuditLogs('org-1', { kind: 'change' });
        expect(whereOn('action')).toEqual([
            { _type: 'where', field: 'action', op: 'in', value: ['create', 'update', 'delete'] },
        ]);
    });

    it('반출 유형은 반출(export)과 증빙서류 열람(read)을 함께 본다', async () => {
        await getAuditLogs('org-1', { kind: 'export' });
        expect(whereOn('action')).toEqual([
            { _type: 'where', field: 'action', op: 'in', value: ['export', 'read'] },
        ]);
    });

    it('기간은 at >= Timestamp로 서버에서 자른다', async () => {
        const since = new Date('2026-07-01T00:00:00Z');
        await getAuditLogs('org-1', { since });

        expect(whereOn('at')).toEqual([
            { _type: 'where', field: 'at', op: '>=', value: { _type: 'ts', millis: since.getTime() } },
        ]);
    });

    it('커서를 넘기면 startAfter로 이어 읽는다', async () => {
        const cursor = { id: 'last-doc' };
        await getAuditLogs('org-1', { startAfter: cursor });
        expect(lastConstraints()).toContainEqual({ _type: 'startAfter', cursor });
    });

    it('페이지가 가득 차면 hasMore=true, 마지막 문서를 커서로 돌려준다', async () => {
        const rows = Array.from({ length: 2 }, (_, i) => ({ id: `a${i}`, action: 'login' }));
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf(rows) as never);

        const page = await getAuditLogs('org-1', { pageSize: 2 });

        expect(page.logs).toHaveLength(2);
        expect(page.hasMore).toBe(true);
        expect((page.lastDoc as { id: string }).id).toBe('a1');
    });

    it('페이지가 덜 찼으면 hasMore=false', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf([{ id: 'a0', action: 'login' }]) as never);
        const page = await getAuditLogs('org-1', { pageSize: 2 });
        expect(page.hasMore).toBe(false);
    });

    it('종료일을 지정하면 at <= 로 뒤쪽도 자른다 (직접 지정 기간)', async () => {
        const since = new Date('2026-07-01T00:00:00');
        const until = new Date('2026-07-31T23:59:59.999');
        await getAuditLogs('org-1', { since, until });

        expect(whereOn('at')).toEqual([
            { _type: 'where', field: 'at', op: '>=', value: { _type: 'ts', millis: since.getTime() } },
            { _type: 'where', field: 'at', op: '<=', value: { _type: 'ts', millis: until.getTime() } },
        ]);
    });

    describe('getAuditLogsForExport', () => {
        it('페이지를 나누지 않고 상한까지 한 번에 읽는다 (기간 전체가 담겨야 증빙이 된다)', async () => {
            await getAuditLogsForExport('org-1', { kind: 'access' });

            expect(lastConstraints()).toContainEqual({ _type: 'limit', n: AUDIT_LOG_EXPORT_MAX });
            expect(lastConstraints().some((c) => c._type === 'startAfter')).toBe(false);
            expect(whereOn('organizationId')).toHaveLength(1);
        });

        it('상한에 걸리면 truncated로 알린다 (조용히 자르지 않는다)', async () => {
            const rows = Array.from({ length: AUDIT_LOG_EXPORT_MAX }, (_, i) => ({ id: `a${i}`, action: 'login' }));
            vi.mocked(fs.getDocs).mockResolvedValue(snapOf(rows) as never);

            const result = await getAuditLogsForExport('org-1');
            expect(result.logs).toHaveLength(AUDIT_LOG_EXPORT_MAX);
            expect(result.truncated).toBe(true);
        });

        it('상한 미달이면 truncated=false', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(snapOf([{ id: 'a0', action: 'login' }]) as never);
            const result = await getAuditLogsForExport('org-1');
            expect(result.truncated).toBe(false);
        });
    });

    it('실패는 Sentry에 보고하고 그대로 던진다 (조용히 빈 목록을 만들지 않는다)', async () => {
        vi.mocked(fs.getDocs).mockRejectedValue(new Error('permission-denied'));
        await expect(getAuditLogs('org-1')).rejects.toThrow('permission-denied');
        expect(captureError).toHaveBeenCalled();
    });

    describe('직원 필터', () => {
        it('직원을 고르면 기관 격리 AND (행위자 == uid OR 대상에 uid 포함)으로 조회한다', async () => {
            await getAuditLogs('org-1', { uid: 'u1', kind: 'change', since: new Date('2026-09-01') });

            const [composite, ...rest] = lastConstraints() as unknown as Array<{ _type: string; filters: Array<Record<string, unknown>> }>;
            expect(composite._type).toBe('and');
            expect(composite.filters).toContainEqual({ _type: 'where', field: 'organizationId', op: '==', value: 'org-1' });
            expect(composite.filters).toContainEqual({ _type: 'where', field: 'action', op: 'in', value: ['create', 'update', 'delete'] });
            expect(composite.filters).toContainEqual({
                _type: 'or',
                filters: [
                    { _type: 'where', field: 'actorUid', op: '==', value: 'u1' },
                    { _type: 'where', field: 'subjectUids', op: 'array-contains', value: 'u1' },
                ],
            });
            // 정렬·상한은 필터 바깥에 그대로 붙는다
            expect(rest).toContainEqual({ _type: 'orderBy', field: 'at', dir: 'desc' });
            expect(rest).toContainEqual({ _type: 'limit', n: AUDIT_LOG_PAGE_SIZE });
        });

        it('차량 필터는 vehicleId 동등 조건으로, 직원 필터와 함께면 AND 안에 들어간다', async () => {
            await getAuditLogs('org-1', { vehicleId: 'car-1' });
            expect(whereOn('vehicleId')).toEqual([{ _type: 'where', field: 'vehicleId', op: '==', value: 'car-1' }]);

            await getAuditLogs('org-1', { vehicleId: 'car-1', uid: 'u1' });
            const [composite] = lastConstraints() as unknown as Array<{ _type: string; filters: Array<Record<string, unknown>> }>;
            expect(composite.filters).toContainEqual({ _type: 'where', field: 'vehicleId', op: '==', value: 'car-1' });
            expect(composite.filters).toContainEqual({ _type: 'where', field: 'organizationId', op: '==', value: 'org-1' });
        });

        it('직원을 고르지 않으면 OR 필터를 만들지 않는다', async () => {
            await getAuditLogs('org-1');
            expect(fs.or).not.toHaveBeenCalled();
            expect(fs.and).not.toHaveBeenCalled();
        });
    });

    describe('차량 정보가 없는 옛 기록 — 보조 조회', () => {
        it('대상 ID를 30개씩 나눠 기관 격리 + targetId in으로만 읽는다 (복합 인덱스 불필요)', async () => {
            const ids = Array.from({ length: 31 }, (_, i) => `dl-${i}`);
            await getAuditLogsByTargets('org-1', [...ids, 'dl-0', '']);

            const calls = vi.mocked(fs.query).mock.calls.map((c) => c.slice(1) as unknown as WhereConstraint[]);
            expect(calls).toHaveLength(2);
            for (const constraints of calls) {
                expect(constraints).toContainEqual({ _type: 'where', field: 'organizationId', op: '==', value: 'org-1' });
                expect(constraints.filter((c) => c.field !== 'organizationId' && c.field !== 'targetId')).toEqual([]);
            }
            expect((calls[0].find((c) => c.field === 'targetId')!.value as string[])).toHaveLength(30);
            expect((calls[1].find((c) => c.field === 'targetId')!.value as string[])).toEqual(['dl-30']);
        });

        it('대상이 없으면 조회하지 않는다', async () => {
            expect(await getAuditLogsByTargets('org-1', [])).toEqual([]);
            expect(fs.getDocs).not.toHaveBeenCalled();
        });

        it('filterAuditLogs는 서버 조회와 같은 기간·유형·직원 조건을 적용하고 최신순으로 돌려준다', () => {
            const at = (iso: string) => ({ toMillis: () => new Date(iso).getTime() }) as unknown as AuditLog['at'];
            const log = (id: string, iso: string, over: Partial<AuditLog> = {}): AuditLog => ({
                id, organizationId: 'org-1', action: 'update', targetType: 'driveLog', targetId: 'dl-1',
                actorUid: 'u1', actorSource: 'stamp', subjectUids: ['u2'], at: at(iso), expiresAt: at(iso), ...over,
            });
            const logs = [
                log('in-old', '2026-09-10T00:00:00Z'),
                log('in-new', '2026-09-20T00:00:00Z'),
                log('too-old', '2026-08-01T00:00:00Z'),
                log('login', '2026-09-15T00:00:00Z', { action: 'login' }),
                log('other-person', '2026-09-16T00:00:00Z', { actorUid: 'u9', subjectUids: ['u8'] }),
            ];

            const out = filterAuditLogs(logs, {
                since: new Date('2026-09-01T00:00:00Z'), kind: 'change', uid: 'u2',
            });
            expect(out.map((l) => l.id)).toEqual(['in-new', 'in-old']);
        });
    });
});
