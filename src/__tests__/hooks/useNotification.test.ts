import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'emp1' },
        userData: { organizationId: 'org1', name: '김직원' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../lib/firestore', () => ({
    updateUser: vi.fn().mockResolvedValue({}),
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
});
