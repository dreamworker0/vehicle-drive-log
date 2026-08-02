/**
 * firestore/auditLogs 도메인 함수 단위 테스트
 *
 * 고정하는 계약:
 *  (1) 멀티테넌트 격리 — organizationId 필터 없이는 절대 조회하지 않는다
 *  (2) 유형 필터는 action `in` 하나로 처리한다 (인덱스가 1개면 충분한 근거)
 *  (3) 최신순 + 페이지 상한 + 커서 (점검 화면이 전량을 읽지 않게)
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
} from '../../../lib/firestore/auditLogs';

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
});
