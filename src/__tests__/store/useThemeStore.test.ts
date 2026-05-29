import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { useThemeStore } from '../../store/useThemeStore';

describe('useThemeStore - getInitialTheme 분기 검증', () => {
    const STORAGE_KEY = 'theme-preference';

    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        if (typeof window !== 'undefined') {
            delete (window as unknown as { matchMedia?: unknown }).matchMedia;
        }
    });

    it('localStorage에 테마 preference가 없고 matchMedia가 정의되지 않은 경우 기본값 light를 반환한다', async () => {
        const { useThemeStore } = await import('../../store/useThemeStore');
        expect(useThemeStore.getState().theme).toBe('light');
    });

    it('localStorage에 저장된 테마가 dark인 경우 dark를 초기값으로 반환한다', async () => {
        localStorage.setItem(STORAGE_KEY, 'dark');
        const { useThemeStore } = await import('../../store/useThemeStore');
        expect(useThemeStore.getState().theme).toBe('dark');
    });

    it('localStorage에 저장된 테마가 light인 경우 light를 초기값으로 반환한다', async () => {
        localStorage.setItem(STORAGE_KEY, 'light');
        const { useThemeStore } = await import('../../store/useThemeStore');
        expect(useThemeStore.getState().theme).toBe('light');
    });

    it('localStorage에 저장된 값이 없고 브라우저 prefers-color-scheme이 dark인 경우 dark를 초기값으로 반환한다', async () => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
            matches: query === '(prefers-color-scheme: dark)',
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        const { useThemeStore } = await import('../../store/useThemeStore');
        expect(useThemeStore.getState().theme).toBe('dark');
    });
});

describe('useThemeStore - 액션 및 상태 변경 검증', () => {
    const STORAGE_KEY = 'theme-preference';
    let store: typeof useThemeStore;

    beforeEach(async () => {
        vi.resetModules();
        localStorage.clear();
        const { useThemeStore } = await import('../../store/useThemeStore');
        store = useThemeStore;
    });

    it('setTheme("dark")를 호출하면 테마 상태가 dark로 바뀌고 localStorage에 저장된다', () => {
        store.getState().setTheme('dark');
        expect(store.getState().theme).toBe('dark');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('setTheme("light")를 호출하면 테마 상태가 light로 바뀌고 localStorage에 저장된다', () => {
        store.getState().setTheme('dark');
        store.getState().setTheme('light');
        expect(store.getState().theme).toBe('light');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('toggleTheme()을 호출하면 dark는 light로, light는 dark로 토글된다', () => {
        store.setState({ theme: 'light' });
        
        store.getState().toggleTheme();
        expect(store.getState().theme).toBe('dark');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

        store.getState().toggleTheme();
        expect(store.getState().theme).toBe('light');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });
});
