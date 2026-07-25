import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useForceLightMode from '../../hooks/useForceLightMode';
import { useThemeStore } from '../../store/useThemeStore';

/**
 * 이 훅은 DOM을 직접 만지지 않고 스토어의 forceLightCount만 조작한다.
 * 실제 dark 클래스 적용은 useThemeSync가 단독으로 하며, 두 훅의 협동은
 * useThemeSync.test.ts의 '강제 라이트' 케이스가 검증한다.
 */
describe('useForceLightMode', () => {
    beforeEach(() => {
        useThemeStore.setState({ theme: 'light', forceLightCount: 0 });
    });

    it('마운트 시 강제 라이트 요구를 등록한다', () => {
        renderHook(() => useForceLightMode());

        expect(useThemeStore.getState().forceLightCount).toBe(1);
    });

    it('언마운트 시 요구를 해제한다', () => {
        const { unmount } = renderHook(() => useForceLightMode());
        expect(useThemeStore.getState().forceLightCount).toBe(1);

        unmount();

        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });

    it('DOM을 직접 만지지 않는다 (적용은 useThemeSync 단독)', () => {
        const root = document.documentElement;
        root.classList.add('dark');
        useThemeStore.setState({ theme: 'dark' });

        renderHook(() => useForceLightMode());

        // 클래스는 그대로 — 이 훅은 카운터만 올린다
        expect(root.classList.contains('dark')).toBe(true);
        root.classList.remove('dark');
    });

    it('여러 화면이 동시에 요구하면 카운터가 쌓이고, 하나가 빠져도 요구가 유지된다', () => {
        const a = renderHook(() => useForceLightMode());
        const b = renderHook(() => useForceLightMode());
        expect(useThemeStore.getState().forceLightCount).toBe(2);

        a.unmount();
        // 남은 화면(b)의 요구가 유지되어야 한다
        expect(useThemeStore.getState().forceLightCount).toBe(1);

        b.unmount();
        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });

    it('중복 해제로 카운터가 음수가 되지 않는다', () => {
        const { unmount } = renderHook(() => useForceLightMode());
        unmount();

        // 예상치 못한 추가 해제 (강제 라이트가 영구히 꺼지는 것을 막는 가드)
        useThemeStore.getState().popForceLight();

        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });
});
