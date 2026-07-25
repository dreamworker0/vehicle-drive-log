import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
    /**
     * 강제 라이트를 요구하는 마운트된 화면의 수 (공개 페이지 등).
     * 0보다 크면 사용자 선호가 dark라도 DOM에는 라이트를 적용한다.
     * 여러 화면이 동시에 요구할 수 있어 불리언이 아니라 카운터다.
     */
    forceLightCount: number;
    /** 강제 라이트 요구 등록 (마운트 시) */
    pushForceLight: () => void;
    /** 강제 라이트 요구 해제 (언마운트 시) */
    popForceLight: () => void;
}

const STORAGE_KEY = 'theme-preference';

const getInitialTheme = (): Theme => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored as Theme;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
};

export const useThemeStore = create<ThemeState>((set) => ({
    theme: getInitialTheme(),
    setTheme: (theme) => {
        localStorage.setItem(STORAGE_KEY, theme);
        set({ theme });
    },
    toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, newTheme);
        return { theme: newTheme };
    }),
    forceLightCount: 0,
    pushForceLight: () => set((state) => ({ forceLightCount: state.forceLightCount + 1 })),
    // 음수 방지: 예상치 못한 중복 해제가 강제 라이트를 영구히 꺼버리지 않도록 0에서 멈춘다
    popForceLight: () => set((state) => ({ forceLightCount: Math.max(0, state.forceLightCount - 1) })),
}));
