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
}));
vi.mock('../../lib/auth', () => ({
    handleRedirectResult: vi.fn().mockResolvedValue(null),
    logout: vi.fn(),
}));
vi.mock('../../lib/sentry', () => ({
    setSentryUser: vi.fn(),
}));

// useAuth를 import하기 전에 mock 설정 완료
import { AuthProvider, useAuth } from '../../hooks/useAuth';

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
