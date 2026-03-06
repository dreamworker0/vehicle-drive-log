import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useForceLightMode from '../../hooks/useForceLightMode';

describe('useForceLightMode', () => {
    const root = document.documentElement;

    afterEach(() => {
        root.classList.remove('dark');
    });

    it('마운트 시 dark 클래스를 제거한다', () => {
        root.classList.add('dark');
        expect(root.classList.contains('dark')).toBe(true);

        renderHook(() => useForceLightMode());

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('dark 클래스가 없으면 아무 일도 안 한다', () => {
        root.classList.remove('dark');

        renderHook(() => useForceLightMode());

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('언마운트 시 원래 dark 모드였으면 복원한다', () => {
        root.classList.add('dark');

        const { unmount } = renderHook(() => useForceLightMode());

        expect(root.classList.contains('dark')).toBe(false);

        unmount();

        expect(root.classList.contains('dark')).toBe(true);
    });

    it('원래 dark 모드가 아니었으면 언마운트 시 추가하지 않는다', () => {
        root.classList.remove('dark');

        const { unmount } = renderHook(() => useForceLightMode());
        unmount();

        expect(root.classList.contains('dark')).toBe(false);
    });
});
