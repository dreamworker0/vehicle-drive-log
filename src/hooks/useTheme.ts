import { useThemeStore } from '../store/useThemeStore';

export function useTheme() {
    const theme = useThemeStore(state => state.theme);
    const toggleTheme = useThemeStore(state => state.toggleTheme);
    
    return {
        theme,
        toggleTheme,
        isDark: theme === 'dark'
    };
}
