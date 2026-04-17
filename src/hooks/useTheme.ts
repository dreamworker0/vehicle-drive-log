import { useThemeStore, Theme } from '../store/useThemeStore';

export function useTheme() {
    const theme = useThemeStore(state => state.theme);
    const toggleTheme = () => useThemeStore.getState().toggleTheme();
    const setTheme = (theme: Theme) => useThemeStore.getState().setTheme(theme);
    
    return {
        theme,
        toggleTheme,
        setTheme,
        isDark: theme === 'dark'
    };
}
