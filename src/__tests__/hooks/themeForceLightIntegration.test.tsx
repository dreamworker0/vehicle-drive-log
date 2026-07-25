import { describe, it, expect, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import useThemeSync from '../../hooks/useThemeSync';
import useForceLightMode from '../../hooks/useForceLightMode';
import { useThemeStore } from '../../store/useThemeStore';

/**
 * 두 훅의 협동을 실제 트리에서 검증한다 (단일 writer 구조의 핵심 계약).
 *
 * 개별 훅 테스트는 forceLightCount를 직접 주입하므로, useForceLightMode의 push/pop과
 * 부모(useThemeSync)·자식(공개 페이지) effect 실행 순서 — 이 구조가 재설계한 바로 그
 * 지점 — 을 지나지 않는다. 여기서 부모/자식으로 실제 마운트해 고정한다.
 *
 * 회귀 배경: 예전엔 useForceLightMode가 dark를 직접 제거했고, effect가 자식→부모 순이라
 * 부모인 useThemeSync가 나중에 실행되며 dark를 다시 붙였다(공개 페이지 체류 중 다크 전환).
 */

/** App 역할 — 테마를 DOM에 반영하는 유일한 주체 */
function AppRoot({ showPublicPage }: { showPublicPage: boolean }) {
    useThemeSync();
    return showPublicPage ? <PublicPage /> : <div>앱 화면</div>;
}

/** 공개 페이지 역할 — 강제 라이트만 요구 */
function PublicPage() {
    useForceLightMode();
    return <div>공개 페이지</div>;
}

describe('useThemeSync + useForceLightMode 협동', () => {
    const root = document.documentElement;

    beforeEach(() => {
        root.classList.remove('dark');
        useThemeStore.setState({ theme: 'light', forceLightCount: 0 });
    });

    it('다크 선호 사용자가 공개 페이지를 열면 라이트로 적용된다', () => {
        useThemeStore.setState({ theme: 'dark' });

        render(<AppRoot showPublicPage />);

        expect(root.classList.contains('dark')).toBe(false);
        expect(useThemeStore.getState().forceLightCount).toBe(1);
    });

    it('공개 페이지를 떠나면 사용자 선호(dark)가 복귀한다', () => {
        useThemeStore.setState({ theme: 'dark' });
        const { rerender } = render(<AppRoot showPublicPage />);
        expect(root.classList.contains('dark')).toBe(false);

        rerender(<AppRoot showPublicPage={false} />);

        expect(root.classList.contains('dark')).toBe(true);
        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });

    // 이 PR의 핵심 회귀: 예전 구조에서는 부모 effect가 나중에 실행되며 dark가 이겼다
    it('공개 페이지 체류 중 테마가 dark로 바뀌어도 다크로 뒤집히지 않는다', () => {
        useThemeStore.setState({ theme: 'light' });
        render(<AppRoot showPublicPage />);
        expect(root.classList.contains('dark')).toBe(false);

        // 체류 중 Firestore 테마 동기화 도착 등으로 선호가 dark로 바뀐 상황
        // (useThemeSync가 스토어를 구독하므로 리렌더를 유발 → act로 감싼다)
        act(() => { useThemeStore.setState({ theme: 'dark' }); });

        expect(root.classList.contains('dark')).toBe(false);
    });

    it('앱 화면에서는 사용자 선호(dark)가 그대로 적용된다', () => {
        useThemeStore.setState({ theme: 'dark' });

        render(<AppRoot showPublicPage={false} />);

        expect(root.classList.contains('dark')).toBe(true);
    });

    // 실제 두 엔트리(appEntry·lightEntry)는 StrictMode로 렌더되므로 이중 마운트에서
    // 카운터가 누수되지 않아야 한다. 누수되면 로그인 후에도 다크가 영구히 안 켜진다.
    it('StrictMode 이중 마운트에서도 카운터가 누수되지 않는다', () => {
        const { unmount } = render(
            <StrictMode>
                <PublicPage />
            </StrictMode>,
        );

        expect(useThemeStore.getState().forceLightCount).toBe(1);

        unmount();

        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });

    it('공개 페이지가 동시에 두 개 마운트돼도 하나가 빠지면 요구가 유지된다', () => {
        useThemeStore.setState({ theme: 'dark' });
        const first = render(<AppRoot showPublicPage />);
        const second = render(<PublicPage />);
        expect(useThemeStore.getState().forceLightCount).toBe(2);
        expect(root.classList.contains('dark')).toBe(false);

        second.unmount();

        // 남은 공개 페이지의 요구가 유지되어 라이트여야 한다
        expect(useThemeStore.getState().forceLightCount).toBe(1);
        expect(root.classList.contains('dark')).toBe(false);

        first.unmount();
        expect(useThemeStore.getState().forceLightCount).toBe(0);
    });
});
