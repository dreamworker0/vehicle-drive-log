/**
 * useAuditLogs — 접속기록 점검 조회 훅
 *
 * 고정하는 계약:
 *  (1) 기관이 없으면 조회하지 않는다 (다른 기관 기록을 볼 경로를 만들지 않는다)
 *  (2) 기간·유형이 바뀌면 첫 페이지부터 다시 읽는다 (커서가 섞이면 목록이 어긋난다)
 *  (3) 더 보기는 커서로 이어 붙인다
 *  (4) uid는 구성원 이름으로 바꿔 보여주고, 모르는 uid는 축약해 표시한다
 *  (5) 조회 실패는 화면 문구로 알린다 (빈 목록으로 위장하지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    getAuditLogs: vi.fn(),
    getOrganizationMembers: vi.fn(),
    auth: { userData: null as { organizationId?: string | null } | null },
    captureError: vi.fn(),
}));

vi.mock('../../lib/firestore', () => ({
    getAuditLogs: mocks.getAuditLogs,
    getOrganizationMembers: mocks.getOrganizationMembers,
    AUDIT_LOG_PAGE_SIZE: 50,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import useAuditLogs from '../../hooks/useAuditLogs';

const page = (ids: string[], hasMore = false) => ({
    logs: ids.map((id) => ({ id, action: 'login', targetType: 'session', subjectUids: [] })),
    lastDoc: ids.length ? { id: ids[ids.length - 1] } : null,
    hasMore,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.userData = { organizationId: 'org-1' };
    mocks.getAuditLogs.mockResolvedValue(page(['a1', 'a2']));
    mocks.getOrganizationMembers.mockResolvedValue([
        { id: 'u1', name: '김간사', email: 'kim@x.or.kr' },
        { id: 'u2', name: '', email: 'lee@x.or.kr' },
    ]);
});

describe('useAuditLogs', () => {
    it('기관이 없으면 조회하지 않는다', async () => {
        mocks.auth.userData = { organizationId: null };
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mocks.getAuditLogs).not.toHaveBeenCalled();
        expect(result.current.logs).toEqual([]);
    });

    it('기본값은 최근 30일·전체 유형으로 조회한다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.days).toBe(30);
        expect(result.current.kind).toBe('all');
        const [orgId, options] = mocks.getAuditLogs.mock.calls[0];
        expect(orgId).toBe('org-1');
        expect(options.kind).toBe('all');
        // 30일 전후 오차를 허용해 '기간이 실제로 좁혀졌는지'만 고정한다
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThan(29);
        expect(diffDays).toBeLessThan(31);
    });

    it('유형을 바꾸면 커서 없이 첫 페이지부터 다시 읽는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setKind('export'));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        expect(options.kind).toBe('export');
        expect(options.startAfter).toBeUndefined();
    });

    it('기간을 바꾸면 다시 읽는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setDays(90));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThan(89);
    });

    it('더 보기는 커서로 이어 붙인다', async () => {
        mocks.getAuditLogs.mockResolvedValueOnce(page(['a1', 'a2'], true));
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        mocks.getAuditLogs.mockResolvedValueOnce(page(['a3']));
        act(() => result.current.loadMore());

        await waitFor(() => expect(result.current.logs).toHaveLength(3));
        const [, options] = mocks.getAuditLogs.mock.calls[1];
        expect(options.startAfter).toEqual({ id: 'a2' });
        expect(result.current.hasMore).toBe(false);
    });

    it('더 볼 것이 없으면 loadMore는 아무것도 하지 않는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.loadMore());
        expect(mocks.getAuditLogs).toHaveBeenCalledTimes(1);
    });

    it('uid를 구성원 이름으로 바꾸고, 이름이 없으면 이메일로 대체한다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.nameOf('u1')).toBe('김간사'));
        expect(result.current.nameOf('u2')).toBe('lee@x.or.kr');
    });

    it('구성원이 아닌 uid는 축약해 표시하고, 없으면 알 수 없음으로 둔다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.nameOf('abcdef123456')).toBe('미확인 계정(abcdef)');
        expect(result.current.nameOf(null)).toBe('알 수 없음');
    });

    it('이름 조회가 실패해도 기록은 보여준다', async () => {
        mocks.getOrganizationMembers.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.logs).toHaveLength(2));
        expect(result.current.error).toBe('');
        expect(mocks.captureError).toHaveBeenCalled();
    });

    it('조회 실패는 빈 목록이 아니라 오류 문구로 알린다', async () => {
        mocks.getAuditLogs.mockRejectedValue(new Error('permission-denied'));
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.error).toContain('불러오지 못했습니다'));
        expect(result.current.logs).toEqual([]);
        expect(result.current.hasMore).toBe(false);
    });
});
