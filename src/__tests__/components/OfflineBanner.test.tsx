import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OfflineBanner from '../../components/common/OfflineBanner';

function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

describe('OfflineBanner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setNavigatorOnline(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('온라인 상태에서는 아무것도 렌더하지 않는다', () => {
        const { container } = render(<OfflineBanner />);
        expect(container).toBeEmptyDOMElement();
    });

    it('오프라인 진입 시 role="alert" 배너를 assertive로 띄운다 — 스크린리더 즉시 안내', () => {
        render(<OfflineBanner />);

        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('aria-live', 'assertive');
        expect(alert).toHaveTextContent('오프라인 상태입니다');
    });

    it('처음부터 오프라인이면 마운트 직후에 배너가 보인다 (지하주차장에서 앱을 켠 경우)', () => {
        setNavigatorOnline(false);
        render(<OfflineBanner />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('재연결 시 status 배너로 전환되고 3초 후 사라진다', () => {
        setNavigatorOnline(false);
        render(<OfflineBanner />);

        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('다시 연결되었습니다');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('언마운트 후에는 online/offline 이벤트에 반응하지 않는다 (리스너 해제)', () => {
        const { unmount } = render(<OfflineBanner />);
        unmount();

        // 해제되지 않았다면 setState 경고(act 미적용)가 발생해 setup.ts 가드에 걸린다.
        act(() => {
            window.dispatchEvent(new Event('offline'));
            window.dispatchEvent(new Event('online'));
        });
        expect(document.querySelector('[role="alert"]')).toBeNull();
    });
});
