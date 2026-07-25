import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/** 다크 테마의 Android 상태바 색상 (surface-950과 통일) */
const DARK_THEME_COLOR = '#020617';
/** 라이트 테마의 Android 상태바 색상 (surface-50과 통일) */
const LIGHT_THEME_COLOR = '#f8fafc';

/**
 * 테마 상태를 DOM에 반영합니다 — **`<html>`의 dark 클래스를 쓰는 유일한 코드**입니다.
 * - `dark` 클래스 토글 (TailwindCSS 다크모드 진입점)
 * - `<meta name="theme-color">` 동기화 (Android 상태바 색상)
 *
 * 적용 값은 `theme`(사용자 선호)와 `forceLightCount`(공개 페이지의 강제 라이트 요구)의
 * 조합이다. [useForceLightMode]는 DOM을 직접 만지지 않고 카운터만 올리며, 실제 반영은
 * 여기서만 한다.
 *
 * 왜 단일 writer인가: 예전엔 useForceLightMode가 마운트 시 dark를 직접 제거했는데,
 * React effect가 자식→부모 순으로 실행되므로 체류 중 테마가 바뀌면 **부모인 이 훅이
 * 나중에 실행되어 dark를 다시 붙였다**(공개 페이지가 보는 중에 다크로 전환). 쓰는 주체를
 * 하나로 모으면 **최종 적용값**의 경쟁이 사라진다.
 *
 * 남는 것(의도적): 두 훅 모두 passive `useEffect`라 DOM 쓰기는 첫 페인트 뒤에 일어난다.
 * 따라서 라우트 전환 시 직전 클래스가 1프레임 살아남을 수 있다(다크 앱 → 공개 페이지
 * 진입 시 그 페이지가 한 프레임 다크로 페인트). `useLayoutEffect`로 바꾸면 없어지지만,
 * 전환 1프레임 대비 동기 레이아웃 비용이 커서 현 규모에서는 채택하지 않았다.
 */
export default function useThemeSync() {
    const theme = useThemeStore(state => state.theme);
    const forceLight = useThemeStore(state => state.forceLightCount > 0);

    useEffect(() => {
        const root = document.documentElement;
        // 강제 라이트가 걸려 있으면 사용자 선호가 dark라도 라이트로 적용한다
        const isDark = theme === 'dark' && !forceLight;

        root.classList.toggle('dark', isDark);

        // Android 상태바 색상을 실제 적용된 테마와 통일
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
        }
    }, [theme, forceLight]);
}
