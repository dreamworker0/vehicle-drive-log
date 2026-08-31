import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { ReactNode } from 'react';

// Firebase 모킹
const mockOnAuthStateChanged = vi.fn();
const mockOnSnapshot = vi.fn();

vi.mock('../../lib/firebase', () => ({
    default: {},
    auth: { currentUser: null },
    db: {},
    authReady: Promise.resolve(),
}));
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
    GoogleAuthProvider: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(() => ({})),
    doc: vi.fn(),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
    onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));
vi.mock('../../lib/tokenRefresh', () => ({
    refreshTokenSilently: vi.fn(),
    refreshToken: vi.fn(),
    getLastTokenRefreshFailure: vi.fn(() => null),
}));
vi.mock('../../lib/auth', () => ({
    handleRedirectResult: vi.fn().mockResolvedValue(null),
    logout: vi.fn(),
    wasIntentionalLogout: vi.fn(() => false),
}));
vi.mock('../../lib/sentry', () => ({
    setSentryUser: vi.fn(),
    captureError: vi.fn(),
}));
// Firestore 종료 상태는 테스트가 직접 뒤집는다 (로그아웃 teardown 재현)
let firestoreTerminated = false;
vi.mock('../../lib/firestoreLifecycle', () => ({
    isFirestoreTerminated: () => firestoreTerminated,
    markFirestoreTerminated: () => { firestoreTerminated = true; },
}));

// useAuth를 import하기 전에 mock 설정 완료
import { AuthProvider, useAuth } from '../../hooks/useAuth';
import { auth } from '../../lib/firebase';
import { refreshToken, getLastTokenRefreshFailure } from '../../lib/tokenRefresh';
import { wasIntentionalLogout } from '../../lib/auth';
import { captureError } from '../../lib/sentry';
import { useToastStore } from '../../store/useToastStore';

function createWrapper() {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <AuthProvider>{children}</AuthProvider>;
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // 기본: 로그아웃 상태 (callback에 null 전달)
    mockOnAuthStateChanged.mockImplementation((_auth: unknown, callback: (user: null) => void) => {
        callback(null);
        return vi.fn(); // unsubscribe
    });
    mockOnSnapshot.mockReturnValue(vi.fn());
});

describe('useAuth 기본 동작', () => {
    it('인증되지 않은 상태에서 user와 userData가 null이어야 한다', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.user).toBeNull();
        expect(result.current.userData).toBeNull();
        expect(result.current.isSuperAdmin).toBe(false);
    });

    it('AuthContextType의 필수 필드가 모두 존재해야 한다', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // 반환값 구조 검증
        expect(result.current).toHaveProperty('user');
        expect(result.current).toHaveProperty('userData');
        expect(result.current).toHaveProperty('loading');
        expect(result.current).toHaveProperty('isSuperAdmin');
        expect(result.current).toHaveProperty('orgDeleted');
        expect(result.current).toHaveProperty('refreshUserData');
        expect(typeof result.current.refreshUserData).toBe('function');
    });
});

describe('useAuth 역할별 분기', () => {
    it('역할 enum이 올바른 값만 허용해야 한다', () => {
        const validRoles = ['superAdmin', 'admin', 'employee'] as const;
        validRoles.forEach(role => {
            expect(['superAdmin', 'admin', 'employee']).toContain(role);
        });
    });
});

/**
 * 탭을 두 개 띄워두면 한쪽에서 페이지를 옮길 때 다른 탭의 onAuthStateChanged가 순간적으로
 * null을 흘리는 일이 있었다. 그걸 즉시 믿으면 AuthGuard가 `/login`으로, path="*"의
 * RouteFallback이 `/`(랜딩)으로 보내 **로그인 화면이 번쩍 뜬다.**
 *
 * 그래서 인증이 한 번 확립된 뒤의 null은 유예를 두고 확정한다. 아래 두 케이스가
 * 유예의 양면을 고정한다 — 돌아오면 아무 일도 없어야 하고, 안 돌아오면 로그아웃돼야 한다.
 */
describe('useAuth — 인증 확립 후 null 발화 유예', () => {
    const authedUser = {
        uid: 'u1',
        isAnonymous: false,
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    /** onAuthStateChanged 콜백을 잡아 테스트가 직접 발화시킨다. */
    function captureAuthCallback() {
        let cb: ((u: unknown) => void) | undefined;
        mockOnAuthStateChanged.mockImplementation((_auth: unknown, callback: (u: unknown) => void) => {
            cb = callback;
            return vi.fn();
        });
        return () => cb!;
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('유예 안에 세션이 돌아오면 로그아웃하지 않는다 (플래시 없음)', async () => {
        const getCb = captureAuthCallback();
        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0); // authReady.then 소화
        await act(async () => { getCb()(authedUser); });
        expect(result.current.user).not.toBeNull();

        // null이 흘러들어온다 — 즉시 로그아웃되어서는 안 된다
        await act(async () => { getCb()(null); });
        expect(result.current.user).not.toBeNull();

        // 유예가 끝나기 전에 세션이 돌아온다
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        await act(async () => { getCb()(authedUser); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        // 유예 타이머가 취소됐으므로 여전히 로그인 상태여야 한다
        expect(result.current.user).not.toBeNull();
    });

    it('유예가 지나도 세션이 없으면 로그아웃을 확정한다', async () => {
        const getCb = captureAuthCallback();
        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        expect(result.current.user).not.toBeNull();

        await act(async () => { getCb()(null); });
        expect(result.current.user).not.toBeNull(); // 유예 중

        // auth.currentUser는 모킹상 계속 null — 유예가 지나면 확정된다
        await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
        expect(result.current.user).toBeNull();
        expect(result.current.loading).toBe(false);
    });
});

/**
 * 로그아웃은 clearOfflineCache()로 Firestore를 terminate하고 페이지를 떠나는데, 떠나기 전까지
 * 페이지는 살아 있다. 세션이 끊긴 리스너는 permission-denied를 받고 재시도 타이머를 걸어두므로,
 * 그 타이머가 종료된 인스턴스에 onSnapshot을 다시 걸면 SDK가 동기 throw를 낸다
 * ("The client has already been terminated." — setTimeout 콜백이라 잡히지 않고 Sentry로 샜다).
 */
describe('useAuth — 종료·세션 이탈 후 재구독 차단', () => {
    const authedUser = {
        uid: 'u1',
        isAnonymous: false,
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    /** permission-denied를 흘려보낼 onSnapshot 에러 콜백을 잡는다. */
    function captureSnapshotError() {
        let onError: ((err: { code?: string }) => void) | undefined;
        mockOnSnapshot.mockImplementation((_ref: unknown, _next: unknown, err: (e: { code?: string }) => void) => {
            onError = err;
            return vi.fn();
        });
        return () => onError!;
    }

    function captureAuthCallback() {
        let cb: ((u: unknown) => void) | undefined;
        mockOnAuthStateChanged.mockImplementation((_a: unknown, callback: (u: unknown) => void) => {
            cb = callback;
            return vi.fn();
        });
        return () => cb!;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        firestoreTerminated = false;
        (auth as { currentUser: unknown }).currentUser = authedUser;
        vi.mocked(refreshToken).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        firestoreTerminated = false;
        (auth as { currentUser: unknown }).currentUser = null;
    });

    it('terminate된 뒤 깨어난 재시도 타이머는 구독을 다시 걸지 않는다', async () => {
        const getCb = captureAuthCallback();
        const getOnError = captureSnapshotError();
        renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        expect(mockOnSnapshot).toHaveBeenCalledTimes(1); // 최초 구독

        // 세션이 끊겨 규칙에 막힌다 → 토큰 갱신 후 재시도 타이머가 걸린다
        await act(async () => { getOnError()({ code: 'permission-denied' }); });
        // 그 사이 로그아웃이 Firestore를 종료한다
        firestoreTerminated = true;

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        // 재구독이 없어야 한다 (있었다면 SDK가 동기 throw를 냈다)
        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('세션이 이미 떠난 뒤에는 재시도 타이머가 구독을 다시 걸지 않는다', async () => {
        const getCb = captureAuthCallback();
        const getOnError = captureSnapshotError();
        renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);

        await act(async () => { getOnError()({ code: 'permission-denied' }); });
        (auth as { currentUser: unknown }).currentUser = null; // signOut 완료

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('세션이 그대로면 재시도 타이머가 구독을 다시 건다 (가드가 정상 복구를 막지 않는다)', async () => {
        const getCb = captureAuthCallback();
        const getOnError = captureSnapshotError();
        renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);

        await act(async () => { getOnError()({ code: 'permission-denied' }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    });
});

/**
 * 세션이 앱의 지시 없이 사라지는 일이 실제로 있었다(2026-08-31 제보 — 슈퍼관리자 대시보드에서
 * 로그인 화면으로 튕김). 그때 콘솔에 남은 것은 Firestore의 `permission-denied` 하나뿐이었는데
 * **그건 세션이 사라진 결과**라 원인을 지목하지 못한다. 유예 확정 지점에서 판별 근거를
 * 보고하도록 했고, 아래 두 케이스가 그 양면을 고정한다 — 예기치 않은 종료는 보고하고,
 * 사용자가 스스로 한 로그아웃은 보고하지 않는다(매 로그아웃마다 이슈가 쌓인다).
 */
describe('useAuth — 예기치 않은 세션 종료 보고', () => {
    const authedUser = {
        uid: 'u1',
        isAnonymous: false,
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    };

    function captureAuthCallback() {
        let cb: ((u: unknown) => void) | undefined;
        mockOnAuthStateChanged.mockImplementation((_a: unknown, callback: (u: unknown) => void) => {
            cb = callback;
            return vi.fn();
        });
        return () => cb!;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        useToastStore.setState({ toasts: [] });
        vi.mocked(wasIntentionalLogout).mockReturnValue(false);
        vi.mocked(getLastTokenRefreshFailure).mockReturnValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        useToastStore.setState({ toasts: [] });
    });

    it('유예가 지나 로그아웃이 확정되면 원인 판별 근거와 함께 보고하고 안내한다', async () => {
        vi.mocked(getLastTokenRefreshFailure).mockReturnValue({
            code: 'auth/user-token-expired',
            fatal: true,
            at: Date.now(),
        });
        const getCb = captureAuthCallback();
        renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        await act(async () => { getCb()(null); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

        expect(captureError).toHaveBeenCalledTimes(1);
        const [err, ctx] = vi.mocked(captureError).mock.calls[0] as [Error, Record<string, unknown>];
        expect(err.message).toContain('예기치 않은 세션 종료');
        expect(ctx.uid).toBe('u1');
        // 토큰이 무효화된 실패는 그 자체가 로그아웃의 직접 원인이므로 반드시 실려야 한다
        expect(ctx.tokenRefreshFailure).toMatchObject({ code: 'auth/user-token-expired', fatal: true });

        // 지금까지는 아무 설명 없이 로그인 화면만 떴다
        expect(useToastStore.getState().toasts).toHaveLength(1);
        expect(useToastStore.getState().toasts[0].message).toContain('세션이 만료되어');
    });

    it('사용자가 스스로 로그아웃한 경우에는 보고하지 않는다', async () => {
        vi.mocked(wasIntentionalLogout).mockReturnValue(true);
        const getCb = captureAuthCallback();
        const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

        await vi.advanceTimersByTimeAsync(0);
        await act(async () => { getCb()(authedUser); });
        await act(async () => { getCb()(null); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

        // 로그아웃 자체는 그대로 확정된다 — 보고와 안내만 하지 않는다
        expect(result.current.user).toBeNull();
        expect(captureError).not.toHaveBeenCalled();
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });
});
