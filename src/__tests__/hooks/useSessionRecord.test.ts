/**
 * useSessionRecord — 로그인 세션 접속기록 호출
 *
 * 고정하는 계약:
 *  (1) 사용자 문서가 확정되기 전에는 부르지 않는다 (기관이 __system__으로 잘못 남는다)
 *  (2) 리렌더·재마운트로 중복 호출하지 않는다
 *  (3) 같은 브라우저 세션은 같은 sessionId를 재사용한다 (서버 문서 ID가 된다)
 *  (4) 기록에 성공한 세션은 다시 부팅돼도 호출하지 않는다 (JAVASCRIPT-REACT-65)
 *  (5) 실패한 세션은 다음 부팅에서 한 번 더 시도한다 — 기록을 유실하지 않는다
 *  (6) 실패해도 throw하지 않는다 — 접속기록 실패가 화면을 막으면 안 된다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    auth: { user: null as { uid: string } | null, userDocState: 'pending' as string },
    captureError: vi.fn(),
    /** Firebase Auth의 현재 사용자 — 보고 시점에 세션이 남아 있는지 판정하는 값 */
    firebaseAuth: { currentUser: null as { uid: string } | null },
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: () => mocks.callable,
}));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {}, db: {}, auth: mocks.firebaseAuth }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import useSessionRecord from '../../hooks/useSessionRecord';

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.callable.mockResolvedValue({ data: { success: true } });
    mocks.auth.user = null;
    mocks.auth.userDocState = 'pending';
    mocks.firebaseAuth.currentUser = null;
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

    // 안드로이드가 백그라운드 PWA를 회수했다가 복귀시키면 페이지가 통째로 다시 부팅된다.
    // 그때마다 부르면 남는 기록은 그대로인 채 서버의 시간당 상한만 깎여 429가 난다
    // (JAVASCRIPT-REACT-65 — Samsung Internet 30 / Android 10, /employee/today).
    it('기록에 성공한 세션은 재부팅해도 다시 부르지 않는다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';

        const first = renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        first.unmount();

        // 같은 브라우저 세션(sessionStorage 유지)에서의 재부팅
        renderHook(() => useSessionRecord());
        await Promise.resolve();
        expect(mocks.callable).toHaveBeenCalledTimes(1);
    });

    it('계정이 바뀌면 같은 브라우저 세션이라도 새로 기록한다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';

        const first = renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        first.unmount();

        mocks.auth.user = { uid: 'u2' };
        renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(2));
        // 브라우저 세션이 같으므로 sessionId는 그대로 — 계정만 다른 별개의 접속이다
        expect(mocks.callable.mock.calls[1][0].sessionId).toBe(mocks.callable.mock.calls[0][0].sessionId);
    });

    it('기록에 실패한 세션은 다음 부팅에서 한 번 더 시도한다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.callable.mockRejectedValue(
            Object.assign(new Error('요청이 너무 많습니다. 1시간 후 다시 시도해주세요. [429]'), { code: 'functions/resource-exhausted' })
        );

        const first = renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        first.unmount();

        mocks.callable.mockResolvedValue({ data: { success: true } });
        renderHook(() => useSessionRecord());
        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(2));
        // 표식은 성공한 뒤에만 남으므로 같은 문서를 다시 채울 기회가 있다
        expect(mocks.callable.mock.calls[1][0].sessionId).toBe(mocks.callable.mock.calls[0][0].sessionId);
    });

    // 서버가 의도적으로 돌려준 거부다. 사용자가 손쓸 것도 없고 앱 결함도 아니라
    // 보고해도 조치로 이어지지 않는다 — 조치 없는 보고는 진짜 결함을 덮는다.
    it('서버 상한 초과(429)는 보고하지 않는다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.firebaseAuth.currentUser = { uid: 'u1' };
        mocks.callable.mockRejectedValue(
            Object.assign(new Error('요청이 너무 많습니다. 1시간 후 다시 시도해주세요. [429]'), { code: 'functions/resource-exhausted' })
        );

        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        expect(mocks.captureError).not.toHaveBeenCalled();
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

    // 로그아웃·세션 만료의 꼬리에서 나는 `Unauthenticated`는 앱 결함이 아니다.
    // (Sentry에 JAVASCRIPT-REACT로 올라오던 건 — 조치할 것이 없는 보고는 진짜 결함을 덮는다)
    it('이미 로그아웃된 세션의 Unauthenticated는 보고하지 않는다', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.firebaseAuth.currentUser = null; // 보고 시점에 세션이 사라진 상태
        mocks.callable.mockRejectedValue(
            Object.assign(new Error('Unauthenticated'), { code: 'functions/unauthenticated' })
        );

        renderHook(() => useSessionRecord());

        await waitFor(() => expect(mocks.callable).toHaveBeenCalledTimes(1));
        expect(mocks.captureError).not.toHaveBeenCalled();
    });

    it('로그인 중인데도 Unauthenticated면 그대로 보고한다 (진짜 권한 문제일 수 있다)', async () => {
        mocks.auth.user = { uid: 'u1' };
        mocks.auth.userDocState = 'present';
        mocks.firebaseAuth.currentUser = { uid: 'u1' };
        mocks.callable.mockRejectedValue(
            Object.assign(new Error('Unauthenticated'), { code: 'functions/unauthenticated' })
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
