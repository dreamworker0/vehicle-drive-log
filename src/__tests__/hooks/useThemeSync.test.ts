import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useThemeSync from '../../hooks/useThemeSync';
import { useThemeStore } from '../../store/useThemeStore';

/**
 * 이 훅은 기존에 App.tsx 인라인 useEffect였고, 삭제된 E2E(`e2e/theme-toggle.spec.ts`)가
 * 검증을 시도했으나 실제로는 아무것도 검증하지 못했다(자기충족 단언 + 앱이 마운트되지
 * 않는 경로에서 실행). 순수 DOM 동기화 로직이므로 단위 테스트로 결정적으로 검증한다.
 *
 * 여기서는 forceLightCount를 직접 주입해 이 훅의 판정 로직만 본다. 실제 push/pop과
 * 부모·자식 effect 순서까지 포함한 협동은 `themeForceLightIntegration.test.tsx`가 검증한다.
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
        useThemeStore.setState({ theme: 'light', forceLightCount: 0 });
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

    describe('강제 라이트(forceLightCount)와의 협동', () => {
        it('강제 라이트가 걸려 있으면 theme이 dark라도 라이트로 적용한다', () => {
            useThemeStore.setState({ theme: 'dark', forceLightCount: 1 });

            renderHook(() => useThemeSync());

            expect(root.classList.contains('dark')).toBe(false);
        });

        // 회귀: 예전엔 useForceLightMode가 dark를 직접 제거했고, effect가 자식→부모 순이라
        // 체류 중 테마가 바뀌면 부모인 useThemeSync가 나중에 실행되어 dark를 다시 붙였다
        // (공개 페이지를 보는 중에 다크로 전환). 단일 writer가 됐으니 이제 뒤집히지 않는다.
        it('강제 라이트 중 테마가 light→dark로 바뀌어도 다크로 뒤집히지 않는다', () => {
            useThemeStore.setState({ theme: 'light', forceLightCount: 1 });
            renderHook(() => useThemeSync());
            expect(root.classList.contains('dark')).toBe(false);

            act(() => { useThemeStore.setState({ theme: 'dark' }); });

            expect(root.classList.contains('dark')).toBe(false);
        });

        it('강제 라이트가 해제되면 사용자 선호(dark)를 즉시 반영한다', () => {
            useThemeStore.setState({ theme: 'dark', forceLightCount: 1 });
            renderHook(() => useThemeSync());
            expect(root.classList.contains('dark')).toBe(false);

            act(() => { useThemeStore.setState({ forceLightCount: 0 }); });

            expect(root.classList.contains('dark')).toBe(true);
        });

        it('강제 라이트 중에는 theme-color도 라이트 색상으로 유지한다', () => {
            const meta = setupMeta('#020617');
            useThemeStore.setState({ theme: 'dark', forceLightCount: 1 });

            renderHook(() => useThemeSync());

            expect(meta.getAttribute('content')).toBe('#f8fafc');
        });

        // 카운터 누적 자체의 계약은 useForceLightMode.test와 통합 테스트가 커버한다.
        // 여기서는 "0이 아니면 라이트"라는 판정만 경계값으로 확인한다.
        it('요구가 2건이어도 라이트로 적용한다 (0 여부만 본다)', () => {
            useThemeStore.setState({ theme: 'dark', forceLightCount: 2 });

            renderHook(() => useThemeSync());

            expect(root.classList.contains('dark')).toBe(false);
        });
    });
});
