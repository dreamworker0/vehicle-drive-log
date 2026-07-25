import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/** 다크 테마의 Android 상태바 색상 (surface-950과 통일) */
const DARK_THEME_COLOR = '#020617';
/** 라이트 테마의 Android 상태바 색상 (surface-50과 통일) */
const LIGHT_THEME_COLOR = '#f8fafc';

/**
 * 테마 스토어의 값을 DOM에 반영합니다.
 * - `<html>`의 `dark` 클래스 토글 (TailwindCSS 다크모드 진입점)
 * - `<meta name="theme-color">` 동기화 (Android 상태바 색상)
 *
 * 공개 페이지에서 다크모드를 강제로 끄는 [useForceLightMode]와 짝을 이룬다
 * (그쪽은 마운트/언마운트로 일시 무효화, 이쪽은 스토어 값이 원본).
 */
export default function useThemeSync() {
    const theme = useThemeStore(state => state.theme);

    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

        // Android 상태바 색상을 테마 배경색과 통일
        const themeColor = theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', themeColor);
        }
    }, [theme]);
}
