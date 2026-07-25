import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useThemeSync from '../../hooks/useThemeSync';
import { useThemeStore } from '../../store/useThemeStore';

/**
 * 이 훅은 기존에 App.tsx 인라인 useEffect였고, E2E(`e2e/theme-toggle.spec.ts`)가
 * 검증을 시도했으나 실제로는 아무것도 검증하지 못했다 —
 * 랜딩 페이지(`/`)는 useForceLightMode로 dark를 의도적으로 제거하는데
 * 그 위에서 dark 클래스를 수동으로 붙이고 "있어야 한다"고 단언해 레이스로 실패했다.
 * 순수 DOM 동기화 로직이므로 단위 테스트로 결정적으로 검증한다.
 */
describe('useThemeSync', () => {
    const root = document.documentElement;

    /** theme-color 메타 태그를 만들고 초기 content를 지정 */
    function setupMeta(initial = '#ffffff'): HTMLMetaElement {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        meta.setAttribute('content', initial);
        document.head.appendChild(meta);
        return meta;
    }

    // 마운트된 컴포넌트가 없는 시점에 초기화한다 (act 경고 회피)
    beforeEach(() => {
        root.classList.remove('dark');
        document.querySelector('meta[name="theme-color"]')?.remove();
        useThemeStore.setState({ theme: 'light' });
    });

    afterEach(() => {
        root.classList.remove('dark');
        document.querySelector('meta[name="theme-color"]')?.remove();
    });

    it('theme이 dark면 html에 dark 클래스를 추가한다', () => {
        useThemeStore.setState({ theme: 'dark' });

        renderHook(() => useThemeSync());

        expect(root.classList.contains('dark')).toBe(true);
    });

    it('theme이 light면 html의 dark 클래스를 제거한다', () => {
        root.classList.add('dark');

        renderHook(() => useThemeSync());

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('스토어의 theme이 바뀌면 dark 클래스도 따라 토글된다', () => {
        renderHook(() => useThemeSync());
        expect(root.classList.contains('dark')).toBe(false);

        act(() => { useThemeStore.setState({ theme: 'dark' }); });
        expect(root.classList.contains('dark')).toBe(true);

        act(() => { useThemeStore.setState({ theme: 'light' }); });
        expect(root.classList.contains('dark')).toBe(false);
    });

    it('dark 테마면 theme-color 메타를 다크 배경색으로 동기화한다', () => {
        const meta = setupMeta();
        useThemeStore.setState({ theme: 'dark' });

        renderHook(() => useThemeSync());

        expect(meta.getAttribute('content')).toBe('#020617');
    });

    it('light 테마면 theme-color 메타를 라이트 배경색으로 동기화한다', () => {
        const meta = setupMeta('#020617');

        renderHook(() => useThemeSync());

        expect(meta.getAttribute('content')).toBe('#f8fafc');
    });

    it('theme 변경 시 theme-color 메타도 함께 갱신된다', () => {
        const meta = setupMeta();
        renderHook(() => useThemeSync());
        expect(meta.getAttribute('content')).toBe('#f8fafc');

        act(() => { useThemeStore.setState({ theme: 'dark' }); });
        expect(meta.getAttribute('content')).toBe('#020617');
    });

    it('theme-color 메타 태그가 없어도 예외 없이 동작한다', () => {
        useThemeStore.setState({ theme: 'dark' });

        expect(() => renderHook(() => useThemeSync())).not.toThrow();
        expect(root.classList.contains('dark')).toBe(true);
    });
});
