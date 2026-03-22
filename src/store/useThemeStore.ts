import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
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
}));
