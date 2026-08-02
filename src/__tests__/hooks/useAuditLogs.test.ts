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
    getAuditLogsForExport: vi.fn(),
    getOrganizationMembers: vi.fn(),
    downloadAuditLogsExcel: vi.fn(),
    auth: { userData: null as { organizationId?: string | null } | null },
    captureError: vi.fn(),
}));

vi.mock('../../lib/firestore', () => ({
    getAuditLogs: mocks.getAuditLogs,
    getAuditLogsForExport: mocks.getAuditLogsForExport,
    getOrganizationMembers: mocks.getOrganizationMembers,
    AUDIT_LOG_PAGE_SIZE: 50,
    AUDIT_LOG_EXPORT_MAX: 5000,
}));
vi.mock('../../lib/excelExport', () => ({ downloadAuditLogsExcel: mocks.downloadAuditLogsExcel }));
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
    mocks.getAuditLogsForExport.mockResolvedValue({ logs: page(['a1', 'a2']).logs, truncated: false });
    mocks.downloadAuditLogsExcel.mockResolvedValue(true);
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

    it('1년(365일) 기간도 그대로 서버 필터로 넘긴다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setDays(365));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        // 보관기간(1년)과 같은 범위까지 닿는지 고정한다
        expect(diffDays).toBeGreaterThan(364);
        expect(diffDays).toBeLessThan(367);
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

    describe('직접 지정 기간', () => {
        it('시작·종료가 모두 채워지기 전에는 프리셋을 유지한다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(false));
            // 한쪽만 입력된 중간 상태로 조회를 갈아치우면 타이핑 중에 목록이 몇 번씩 바뀐다
            expect(mocks.getAuditLogs).toHaveBeenCalledTimes(1);
        });

        it('양쪽이 채워지면 그 범위로 조회하고 종료일 하루를 포함한다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01', end: '2026-07-31' }));
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

            const [, options] = mocks.getAuditLogs.mock.calls[1];
            expect(result.current.rangeActive).toBe(true);
            expect((options.since as Date).toISOString()).toBe(new Date('2026-07-01T00:00:00').toISOString());
            // 종료일 23:59:59.999까지 — 마지막 날 기록이 빠지면 그 날은 점검에서 누락된다
            expect((options.until as Date).toISOString()).toBe(new Date('2026-07-31T23:59:59.999').toISOString());
        });

        it('시작일이 종료일보다 늦으면 적용하지 않는다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-31', end: '2026-07-01' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(false));
        });
    });

    describe('엑셀 내보내기', () => {
        it('화면 목록이 아니라 기간 전체를 다시 읽어 내보낸다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalledTimes(1));

            const [orgId, options] = mocks.getAuditLogsForExport.mock.calls[0];
            expect(orgId).toBe('org-1');
            expect(options.kind).toBe('all');
            // 파일명에 기간이 들어가야 여러 번 받은 파일을 구분할 수 있다
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_최근30일');
        });

        it('직접 지정 기간은 파일명에 시작·종료일을 쓴다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01', end: '2026-07-31' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(true));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalled());
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_2026-07-01_2026-07-31');
        });

        it('내보낼 기록이 없으면 파일을 만들지 않고 알린다', async () => {
            mocks.getAuditLogsForExport.mockResolvedValue({ logs: [], truncated: false });
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('내보낼 기록이 없습니다'));
            expect(mocks.downloadAuditLogsExcel).not.toHaveBeenCalled();
        });

        it('상한에 걸려 잘리면 그 사실을 알린다', async () => {
            mocks.getAuditLogsForExport.mockResolvedValue({ logs: page(['a1']).logs, truncated: true });
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('5,000건만'));
        });

        it('내보내기 실패는 화면 문구로 알리고 Sentry에 보고한다', async () => {
            mocks.getAuditLogsForExport.mockRejectedValue(new Error('permission-denied'));
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('내보내기에 실패'));
            expect(mocks.captureError).toHaveBeenCalled();
        });
    });

    it('조회 실패는 빈 목록이 아니라 오류 문구로 알린다', async () => {
        mocks.getAuditLogs.mockRejectedValue(new Error('permission-denied'));
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.error).toContain('불러오지 못했습니다'));
        expect(result.current.logs).toEqual([]);
        expect(result.current.hasMore).toBe(false);
    });
});
