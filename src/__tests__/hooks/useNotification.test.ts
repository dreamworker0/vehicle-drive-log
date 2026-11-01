import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──
const mockAuth: { user: { uid: string }; userData: Record<string, unknown> | null } = {
    user: { uid: 'emp1' },
    userData: { organizationId: 'org1', name: '김직원' },
};
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => mockAuth,
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

const mockUpdateUser = vi.fn().mockResolvedValue({});
vi.mock('../../lib/firestore', () => ({
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
}));

const mockGetToken = vi.fn().mockResolvedValue('mock-fcm-token');
const mockOnMessage = vi.fn().mockReturnValue(() => {});
vi.mock('firebase/messaging', () => ({
    getToken: (...args: unknown[]) => mockGetToken(...args),
    onMessage: (...args: unknown[]) => mockOnMessage(...args),
}));

vi.mock('../../lib/firebase', () => ({
    getMessagingInstance: vi.fn().mockResolvedValue({}),
}));

// VAPID_KEY 모킹
vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');

import useNotification from '../../hooks/useNotification';

describe('useNotification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 상태가 올바르다', async () => {
        const { result } = renderHook(() => useNotification());

        expect(result.current.token).toBeNull();
        expect(typeof result.current.requestPermission).toBe('function');

        // 마운트 시 비동기 FCM 초기화가 act 밖에서 반영되지 않도록 정착 대기
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    });

    it('Notification API가 없는 환경에서 requestPermission이 안전하게 처리된다', async () => {
        // Notification API가 없는 환경 시뮬레이션
        const originalNotification = globalThis.Notification;
        // @ts-expect-error — 테스트를 위해 삭제
        delete globalThis.Notification;

        const { result } = renderHook(() => useNotification());

        await act(async () => {
            const token = await result.current.requestPermission();
            expect(token).toBeNull();
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            '이 브라우저에서는 푸시 알림을 지원하지 않습니다.',
            'warning',
        );

        // 원복
        if (originalNotification) {
            globalThis.Notification = originalNotification;
        }
    });

    it('return 값에 필수 속성이 포함된다', async () => {
        const { result } = renderHook(() => useNotification());

        expect(result.current).toHaveProperty('permission');
        expect(result.current).toHaveProperty('token');
        expect(result.current).toHaveProperty('requestPermission');
        expect(result.current).toHaveProperty('isSupported');

        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    });

    // users 문서를 쓰면 트리거 3개가 깨어난다 — 앱을 열 때마다 같은 토큰을 다시 쓰지 않는지 고정한다
    describe('앱 로드 시 토큰 자동 갱신', () => {
        const originalNotification = globalThis.Notification;
        const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        beforeEach(() => {
            // @ts-expect-error — 권한이 이미 허용된 환경만 흉내 낸다
            globalThis.Notification = { permission: 'granted', requestPermission: vi.fn() };
            mockAuth.userData = { organizationId: 'org1', name: '김직원' };
        });

        afterEach(() => {
            globalThis.Notification = originalNotification;
        });

        it('저장된 토큰과 같으면 users 문서를 쓰지 않는다', async () => {
            mockAuth.userData = { organizationId: 'org1', name: '김직원', fcmToken: 'mock-fcm-token' };
            const { result } = renderHook(() => useNotification());
            await settle();

            expect(mockGetToken).toHaveBeenCalled();
            expect(result.current.token).toBe('mock-fcm-token');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        it('저장된 토큰과 다르면 새 토큰을 쓴다', async () => {
            mockAuth.userData = { organizationId: 'org1', name: '김직원', fcmToken: 'old-token' };
            renderHook(() => useNotification());
            await settle();

            expect(mockUpdateUser).toHaveBeenCalledWith('emp1', { fcmToken: 'mock-fcm-token' });
        });

        it('저장된 토큰이 없으면 쓴다', async () => {
            renderHook(() => useNotification());
            await settle();

            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
        });

        it('users 문서가 아직 로드되지 않았으면 비교할 수 없으므로 기다린다', async () => {
            mockAuth.userData = null;
            renderHook(() => useNotification());
            await settle();

            expect(mockGetToken).not.toHaveBeenCalled();
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });
    });
});
