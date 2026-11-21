import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import UpdateBanner from '../../components/common/UpdateBanner';
import { markUpdateReady, resetUpdateReadyForTest } from '../../lib/pendingUpdate';
import { reloadPage } from '../../lib/browserNav';
import { useToastStore } from '../../store/useToastStore';

vi.mock('../../lib/browserNav', () => ({ reloadPage: vi.fn(), navigateTo: vi.fn(), currentHref: vi.fn(() => '') }));

/**
 * 새 버전 안내 띠와 "화면을 옮기면 새 버전으로 연다"를 고정한다.
 *
 * 지키는 원칙: **쓰던 화면에서 저절로 새로고침하지 않는다**(작성 중인 입력 유실).
 * 새로고침은 ① 사용자가 [업데이트]를 눌렀을 때, ② 다른 화면으로 옮길 때만 일어난다.
 */
function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** 테스트에서 앱 안 화면 이동을 일으키는 손잡이 */
const nav: { go: (to: string) => void } = { go: () => { } };
function NavigateProbe() {
    const navigate = useNavigate();
    useEffect(() => {
        nav.go = (to) => { void navigate(to); };
    }, [navigate]);
    return null;
}
const goTo = (to: string) => nav.go(to);

function renderBanner(initial = '/employee/today') {
    return render(
        <MemoryRouter initialEntries={[initial]}>
            <NavigateProbe />
            <UpdateBanner />
        </MemoryRouter>,
    );
}

describe('UpdateBanner — 새 버전 안내 띠', () => {
    beforeEach(() => {
        resetUpdateReadyForTest();
        vi.mocked(reloadPage).mockClear();
        setNavigatorOnline(true);
        useToastStore.setState({ toasts: [] });
    });
    afterEach(() => {
        setNavigatorOnline(true);
    });

    it('새 버전이 준비되기 전에는 아무것도 그리지 않는다', () => {
        renderBanner();
        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
    });

    it('새 버전이 준비되면 안내를 띄우고, 저절로 새로고침하지는 않는다', () => {
        renderBanner();
        act(() => markUpdateReady());

        expect(screen.getByRole('status')).toHaveTextContent('새 버전이 나왔어요');
        expect(screen.getByRole('button', { name: '업데이트' })).toBeVisible();
        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('[업데이트]를 누르면 새 버전으로 다시 연다', async () => {
        renderBanner();
        act(() => markUpdateReady());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '업데이트' }));
        });

        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('[닫기]를 누르면 띠만 숨긴다', () => {
        renderBanner();
        act(() => markUpdateReady());

        fireEvent.click(screen.getByRole('button', { name: '새 버전 안내 닫기' }));

        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('오프라인이면 띄우지 않는다 — 업데이트할 수 없고 오프라인 띠와 자리가 겹친다', () => {
        setNavigatorOnline(false);
        renderBanner();
        act(() => markUpdateReady());

        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
    });
});

describe('화면을 옮기면 새 버전으로 연다', () => {
    beforeEach(() => {
        resetUpdateReadyForTest();
        vi.mocked(reloadPage).mockClear();
        setNavigatorOnline(true);
        useToastStore.setState({ toasts: [] });
    });

    it('새 버전이 준비된 뒤 다른 화면으로 옮기면 새로고침한다', () => {
        renderBanner('/employee/today');
        act(() => markUpdateReady());

        act(() => goTo('/employee/records'));

        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('새 버전이 없으면 화면을 옮겨도 새로고침하지 않는다', () => {
        renderBanner('/employee/today');

        act(() => goTo('/employee/records'));

        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('같은 화면 안에서 검색 조건(?…)만 바뀌면 새로고침하지 않는다', () => {
        renderBanner('/admin/logs');
        act(() => markUpdateReady());

        act(() => goTo('/admin/logs?month=2026-11'));

        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('오프라인이면 미룬다 — 새 버전 파일을 받을 수 없어 화면이 깨진다', () => {
        renderBanner('/employee/today');
        act(() => markUpdateReady());
        setNavigatorOnline(false);

        act(() => goTo('/employee/records'));

        expect(reloadPage).not.toHaveBeenCalled();
    });

    it('토스트가 떠 있으면 미루고, 다음 화면 이동 때 적용한다 — "저장했어요" 안내가 사라지지 않게', () => {
        renderBanner('/employee/drive-log');
        act(() => markUpdateReady());
        act(() => { useToastStore.getState().showToast('운행일지를 저장했어요', 'success'); });

        act(() => goTo('/employee/today'));
        expect(reloadPage).not.toHaveBeenCalled();

        act(() => useToastStore.setState({ toasts: [] }));
        act(() => goTo('/employee/records'));
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });
});
