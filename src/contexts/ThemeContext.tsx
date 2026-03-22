import { useEffect, ReactNode } from 'react';
import { useThemeStore } from '../store/useThemeStore';

export function ThemeProvider({ children }: { children: ReactNode }) {
    const theme = useThemeStore(state => state.theme);
    const setTheme = useThemeStore(state => state.setTheme);

    // <html>에 dark 클래스 토글 + theme-color 메타 태그 동기화
    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

        // Android 상태바 색상을 테마 배경색과 통일
        const themeColor = theme === 'dark' ? '#020617' : '#f8fafc';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', themeColor);
        }
    }, [theme]);

    // 시스템 설정 변경 감지 (사용자가 수동 설정한 경우 무시)
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => {
            const stored = localStorage.getItem('theme-preference');
            if (!stored) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [setTheme]);

    return <>{children}</>;
}
