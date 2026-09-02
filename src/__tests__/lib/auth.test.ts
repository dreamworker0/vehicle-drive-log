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
    getPendingCount: vi.fn(() => Promise.resolve(0)),
}));
const mockConfirm = vi.fn();
vi.mock('@/store/useConfirmStore', () => ({
    useConfirmStore: { getState: () => ({ confirm: mockConfirm }) },
}));

import { logout } from '@/lib/auth';
import { signOut } from 'firebase/auth';
import { clearOfflineCache } from '@/lib/firebase';
import { clearQueue, getPendingCount } from '@/lib/offline/syncQueue';

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

    // 2026-09-02 — 큐를 무조건 비우는 것은 유지하되, 지하 주차장에서 쓴 미전송 기록이
    // 아무 안내 없이 사라지지 않게 로그아웃 **전에** 건수를 확인하고 묻는다.
    describe('미전송 기록이 있을 때', () => {
        it('건수를 담아 확인을 묻고, 취소하면 signOut·큐 정리·리다이렉트를 하나도 하지 않는다', async () => {
            vi.mocked(getPendingCount).mockResolvedValueOnce(3);
            mockConfirm.mockResolvedValueOnce(false);

            await logout();

            expect(mockConfirm).toHaveBeenCalledTimes(1);
            expect(mockConfirm.mock.calls[0][0]).toMatchObject({ confirmColor: 'danger' });
            expect(mockConfirm.mock.calls[0][0].message).toContain('3건');
            expect(signOut).not.toHaveBeenCalled();
            expect(clearQueue).not.toHaveBeenCalled();
            expect(clearOfflineCache).not.toHaveBeenCalled();
            expect(window.location.href).toBe('');
        });

        it('삭제를 확인하면 종전과 같이 signOut → clearQueue → clearOfflineCache로 진행한다', async () => {
            vi.mocked(getPendingCount).mockResolvedValueOnce(1);
            mockConfirm.mockResolvedValueOnce(true);

            await logout();

            expect(signOut).toHaveBeenCalledTimes(1);
            expect(clearQueue).toHaveBeenCalledTimes(1);
            expect(window.location.href).toBe('/');
        });

        it('미전송 기록이 없으면 묻지 않는다', async () => {
            vi.mocked(getPendingCount).mockResolvedValueOnce(0);
            await logout();
            expect(mockConfirm).not.toHaveBeenCalled();
            expect(signOut).toHaveBeenCalledTimes(1);
        });

        it('건수 조회가 실패하면(IDB 불가) 묻지 않고 로그아웃을 막지 않는다', async () => {
            vi.mocked(getPendingCount).mockRejectedValueOnce(new Error('idb unavailable'));
            await logout();
            expect(mockConfirm).not.toHaveBeenCalled();
            expect(signOut).toHaveBeenCalledTimes(1);
            expect(window.location.href).toBe('/');
        });
    });
});

/**
 * 화면에서 보면 "의도한 로그아웃"과 "세션이 저 혼자 사라진 것"이 똑같다 —
 * 둘 다 onAuthStateChanged(null) 하나로 도착한다. useAuth는 이 표시로 갈라서
 * 후자만 Sentry에 보고한다(전자까지 보고하면 매 로그아웃마다 이슈가 쌓인다).
 *
 * 표시는 모듈 변수 + localStorage 두 겹이라 테스트마다 모듈을 새로 들여온다
 * (resetModules 없이는 앞 테스트의 표시가 10초 창 안에서 그대로 살아 있다).
 */
describe('의도적 로그아웃 표시', () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { href: '' },
        });
    });

    it('표시가 없으면 의도적 로그아웃이 아니다', async () => {
        const { wasIntentionalLogout } = await import('@/lib/auth');
        expect(wasIntentionalLogout()).toBe(false);
    });

    it('logout()은 signOut보다 먼저 표시한다 (발화가 await보다 앞설 수 있다)', async () => {
        const authModule = await import('@/lib/auth');
        const { signOut: freshSignOut } = await import('firebase/auth');

        let markedWhenSignOutCalled = false;
        vi.mocked(freshSignOut).mockImplementationOnce(() => {
            markedWhenSignOutCalled = authModule.wasIntentionalLogout();
            return Promise.resolve();
        });

        await authModule.logout();

        expect(markedWhenSignOutCalled).toBe(true);
    });

    it('다른 탭이 볼 수 있도록 스토리지에도 남긴다 (한 탭의 로그아웃이 다른 탭을 끌고 간다)', async () => {
        const { markIntentionalLogout } = await import('@/lib/auth');
        markIntentionalLogout();
        expect(localStorage.getItem('vdl:intentional-logout')).not.toBeNull();
    });

    it('창을 벗어난 옛 표시는 무시한다 (나중의 진짜 세션 소멸을 덮지 않게)', async () => {
        localStorage.setItem('vdl:intentional-logout', String(Date.now() - 60_000));
        const { wasIntentionalLogout } = await import('@/lib/auth');
        expect(wasIntentionalLogout()).toBe(false);
    });
});
