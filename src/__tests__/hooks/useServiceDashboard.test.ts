// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ──
const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

const mockCallable = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mockCallable,
}));

const mockCurrentUser = { uid: 'super1' };
vi.mock('../../lib/firebase', () => ({
    db: {},
    auth: { get currentUser() { return mockCurrentUser; } },
    firebaseFunctions: {},
}));

const mockRefreshToken = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/tokenRefresh', () => ({
    refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
}));

// 외부 라이브 로더는 대시보드 캐시 로드와 무관한 별도 쿼리 — 호출만 통과시킨다.
vi.mock('../../hooks/serviceDashboard/loadFuelHipassStats', () => ({
    loadFuelHipassStats: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../hooks/serviceDashboard/loadNotificationStats', () => ({
    loadNotificationStats: vi.fn().mockResolvedValue(undefined),
}));

import useServiceDashboard from '../../hooks/useServiceDashboard';

/** 캐시 문서 스냅샷 대역(stub) */
const snap = (data: Record<string, unknown> | null) => ({
    exists: () => data !== null,
    data: () => data,
});

const permissionDenied = () =>
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

describe('useServiceDashboard — 캐시 문서 권한 거부 복구', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it('첫 읽기가 권한 거부면 토큰을 갱신해 다시 읽고 통계를 표시한다', async () => {
        // 1회차: 3건 모두 거부 → 2회차: 정상
        let call = 0;
        mockGetDoc.mockImplementation(() => {
            call++;
            if (call <= 3) return Promise.reject(permissionDenied());
            return Promise.resolve(snap({ totalUsers: 42, lastUpdatedAt: '2026-08-14T02:00:00.000Z' }));
        });

        const { result } = renderHook(() => useServiceDashboard('ALL'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockRefreshToken).toHaveBeenCalledWith(mockCurrentUser);
        expect(result.current.loadError).toBeNull();
        expect(result.current.summary.stats?.totalUsers).toBe(42);
    });

    it('토큰 갱신 후에도 거부되면 loadError를 남겨 화면이 원인을 안내할 수 있게 한다', async () => {
        mockGetDoc.mockRejectedValue(permissionDenied());

        const { result } = renderHook(() => useServiceDashboard('ALL'));

        await waitFor(() => expect(result.current.loadError).toBe('permission'), { timeout: 5000 });
        expect(result.current.loading).toBe(false);
        // 갱신은 재시도 횟수만큼만 — 무한 루프에 빠지지 않는다
        expect(mockRefreshToken).toHaveBeenCalledTimes(2);
    });

    it('권한 외 오류는 unknown으로 구분한다', async () => {
        mockGetDoc.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'unavailable' }));

        const { result } = renderHook(() => useServiceDashboard('ALL'));

        await waitFor(() => expect(result.current.loadError).toBe('unknown'));
        expect(mockRefreshToken).not.toHaveBeenCalled();
    });
});
