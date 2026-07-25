import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useForceLightMode from '../../hooks/useForceLightMode';
import { useThemeStore } from '../../store/useThemeStore';

describe('useForceLightMode', () => {
    const root = document.documentElement;

    // 이 훅은 스토어를 구독하지 않고 cleanup에서 getState()만 읽으므로 setState가
    // 리렌더를 유발하지 않는다 → act() 불필요. 구독 방식으로 바뀌면 setup.ts의
    // act 경고 승격 가드에 걸리니 그때는 act()로 감싸야 한다(useThemeSync.test 참고).
    beforeEach(() => {
        root.classList.remove('dark');
        useThemeStore.setState({ theme: 'light' });
    });

    afterEach(() => {
        root.classList.remove('dark');
        useThemeStore.setState({ theme: 'light' }); // 파일 종료 시 스토어 오염 방지
    });

    it('마운트 시 dark 클래스를 제거한다', () => {
        root.classList.add('dark');
        expect(root.classList.contains('dark')).toBe(true);

        renderHook(() => useForceLightMode());

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('dark 클래스가 없으면 아무 일도 안 한다', () => {
        renderHook(() => useForceLightMode());

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('언마운트 시 스토어가 dark면 dark 클래스를 재적용한다', () => {
        useThemeStore.setState({ theme: 'dark' });

        const { unmount } = renderHook(() => useForceLightMode());
        expect(root.classList.contains('dark')).toBe(false);

        unmount();

        expect(root.classList.contains('dark')).toBe(true);
    });

    it('언마운트 시 스토어가 light면 dark 클래스를 추가하지 않는다', () => {
        useThemeStore.setState({ theme: 'light' });

        const { unmount } = renderHook(() => useForceLightMode());
        unmount();

        expect(root.classList.contains('dark')).toBe(false);
    });

    // 회귀: 마운트 시점 스냅샷을 복원하던 구현에서는, 체류 중 테마가 dark→light로
    // 바뀌면 언마운트 시 낡은 스냅샷이 dark를 되살려 DOM↔스토어가 어긋났다.
    // (useThemeSync는 theme 값이 그대로라 재실행되지 않아 어긋난 상태가 유지됨)
    it('체류 중 테마가 dark→light로 바뀌면 언마운트 시 dark를 되살리지 않는다', () => {
        useThemeStore.setState({ theme: 'dark' });
        const { unmount } = renderHook(() => useForceLightMode());

        // 체류 중 OS 다크→라이트 자동 전환 등으로 스토어가 갱신된 상황
        useThemeStore.setState({ theme: 'light' });
        unmount();

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('체류 중 테마가 light→dark로 바뀌면 언마운트 시 dark를 적용한다', () => {
        useThemeStore.setState({ theme: 'light' });
        const { unmount } = renderHook(() => useForceLightMode());

        useThemeStore.setState({ theme: 'dark' });
        unmount();

        expect(root.classList.contains('dark')).toBe(true);
    });
});
