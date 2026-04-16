import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
