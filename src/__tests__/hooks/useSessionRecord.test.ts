/**
 * useSessionRecord — 로그인 세션 접속기록 호출
 *
 * 고정하는 계약:
 *  (1) 사용자 문서가 확정되기 전에는 부르지 않는다 (기관이 __system__으로 잘못 남는다)
 *  (2) 리렌더·재마운트로 중복 호출하지 않는다
 *  (3) 같은 브라우저 세션은 같은 sessionId를 재사용한다 (서버 문서 ID가 된다)
 *  (4) 실패해도 throw하지 않는다 — 접속기록 실패가 화면을 막으면 안 된다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    auth: { user: null as { uid: string } | null, userDocState: 'pending' as string },
    captureError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: () => mocks.callable,
}));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {}, db: {}, auth: {} }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import useSessionRecord from '../../hooks/useSessionRecord';

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.callable.mockResolvedValue({ data: { success: true } });
    mocks.auth.user = null;
    mocks.auth.userDocState = 'pending';
});

describe('useSessionRecord', () => {
    it('비로그인 상태에서는 부르지 않는다', () => {
        renderHook(() => useSessionRecord());
        expect(mocks.callable).not.toHaveBeenCalled();
    });

    it('사용자 문서가 확정되기 전에는 부르지 않는다', () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'pending';
        renderHook(() => useSessionRecord());
        // 이 시점에 부르면 서버가 기관을 못 찾아 __system__으로 잘못 남는다
        expect(mocks.callable).not.toHaveBeenCalled();
    });

    it('로그인 + 문서 확정이면 세션 식별자와 함께 1회 호출한다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        const sessionId = mocks.callable.mock.calls[0][0].sessionId;
        // 서버의 SESSION_ID_PATTERN과 같은 제약
        expect(sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });

    it('리렌더해도 중복 호출하지 않는다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        const { rerender } = renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        rerender();
        rerender();
        expect(mocks.callable).toHaveBeenCalledTimes(1);
    });

    it('같은 브라우저 세션에서 재마운트하면 같은 sessionId를 재사용한다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';

        const first = renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        first.unmount();

        renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(2));

        // 서버가 같은 문서를 덮어쓰므로 로그가 쌓이지 않는다
        expect(mocks.callable.mock.calls[1][0].sessionId).toBe(mocks.callable.mock.calls[0][0].sessionId);
    });

    it('호출이 실패해도 throw하지 않고 Sentry로만 보고한다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.callable.mockRejectedValue(
            Object.assign(new Error('세션 식별자가 올바르지 않습니다.'), { code: 'functions/invalid-argument' })
        );

        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.captureError).toHaveBeenCalled());
        expect(mocks.captureError.mock.calls[0][1]).toMatchObject({ context: 'useSessionRecord', uid: 'u1' });
    });

    it('응답이 늦으면 같은 sessionId로 다시 부른다 — 서버가 같은 문서를 덮어쓴다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.callable
            // SDK가 시간 초과 시 던지는 것과 같은 모양
            .mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }))
            .mockResolvedValueOnce({ data: { success: true } });

        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(2), { timeout: 5000 });
        expect(mocks.callable.mock.calls[1][0].sessionId).toBe(mocks.callable.mock.calls[0][0].sessionId);
        // 재시도로 기록이 남았으므로 보고할 것이 없다
        expect(mocks.captureError).not.toHaveBeenCalled();
    });

    it('sessionStorage를 쓸 수 없어도 호출을 포기하지 않는다', async () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';

        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        expect(mocks.callable.mock.calls[0][0].sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        spy.mockRestore();
    });
});
