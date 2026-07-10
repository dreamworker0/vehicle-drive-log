import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// firebase/auth·firebase 초기화·offline 큐를 모두 목으로 대체해 logout 오케스트레이션만 검증한다.
vi.mock('firebase/auth', () => ({
    signOut: vi.fn(() => Promise.resolve()),
    signInWithPopup: vi.fn(() => Promise.resolve()),
    signInWithRedirect: vi.fn(() => Promise.resolve()),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/lib/firebase', () => ({
    auth: {},
    googleProvider: {},
    clearOfflineCache: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/offline/syncQueue', () => ({
    clearQueue: vi.fn(() => Promise.resolve()),
}));

import { logout } from '@/lib/auth';
import { signOut } from 'firebase/auth';
import { clearOfflineCache } from '@/lib/firebase';
import { clearQueue } from '@/lib/offline/syncQueue';

const originalLocation = window.location;

describe('logout (2026-07-10 감사 #8 — 공용 기기 잔존 데이터 폐기)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // window.location.href 할당을 관찰하기 위해 목으로 대체 (jsdom 네비게이션 미구현 경고 회피)
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { href: '' },
        });
    });
    afterAll(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('signOut → clearQueue → clearOfflineCache 순서로 실행하고 루트로 이동한다', async () => {
        await logout();

        expect(signOut).toHaveBeenCalledTimes(1);
        expect(clearQueue).toHaveBeenCalledTimes(1);
        expect(clearOfflineCache).toHaveBeenCalledTimes(1);

        const signOutOrder = vi.mocked(signOut).mock.invocationCallOrder[0];
        const clearQueueOrder = vi.mocked(clearQueue).mock.invocationCallOrder[0];
        const clearCacheOrder = vi.mocked(clearOfflineCache).mock.invocationCallOrder[0];
        expect(signOutOrder).toBeLessThan(clearQueueOrder);
        expect(clearQueueOrder).toBeLessThan(clearCacheOrder);

        expect(window.location.href).toBe('/');
    });

    it('큐 정리 실패가 캐시 폐기와 리다이렉트를 막지 않는다', async () => {
        vi.mocked(clearQueue).mockRejectedValueOnce(new Error('idb failure'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await logout();

        expect(clearOfflineCache).toHaveBeenCalledTimes(1);
        expect(window.location.href).toBe('/');
    });

    it('signOut 실패 시 예외를 던지고 이후 정리를 수행하지 않는다', async () => {
        vi.mocked(signOut).mockRejectedValueOnce(new Error('network'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(logout()).rejects.toThrow('network');

        expect(clearQueue).not.toHaveBeenCalled();
        expect(clearOfflineCache).not.toHaveBeenCalled();
    });
});
