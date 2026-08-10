import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OfflineBanner from '../../components/common/OfflineBanner';

// 큐 개수는 IndexedDB를 여는 비동기 읽기다. 배너가 그 숫자를 어떻게 보여 주는지만 보려는
// 테스트이므로 값을 직접 정해 준다(큐 자체의 계약은 syncQueue 테스트가 본다).
const mockGetPendingCount = vi.fn<() => Promise<number>>(() => Promise.resolve(0));
vi.mock('@/lib/offline/syncQueue', () => ({
    getPendingCount: () => mockGetPendingCount(),
}));

function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** 훅의 첫 조회(마이크로태스크)가 반영되도록 한 틱 흘린다 */
async function settle() {
    await act(async () => { await Promise.resolve(); });
}

describe('OfflineBanner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setNavigatorOnline(true);
        mockGetPendingCount.mockResolvedValue(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('온라인 상태에서는 아무것도 렌더하지 않는다', async () => {
        const { container } = render(<OfflineBanner />);
        await settle();
        expect(container).toBeEmptyDOMElement();
    });

    it('오프라인 진입 시 role="alert" 배너를 assertive로 띄운다 — 스크린리더 즉시 안내', async () => {
        render(<OfflineBanner />);
        await settle();

        await act(async () => {
            window.dispatchEvent(new Event('offline'));
            await Promise.resolve();
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('aria-live', 'assertive');
        expect(alert).toHaveTextContent('오프라인 상태입니다');
    });

    it('처음부터 오프라인이면 마운트 직후에 배너가 보인다 (지하주차장에서 앱을 켠 경우)', async () => {
        setNavigatorOnline(false);
        render(<OfflineBanner />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        await settle();
    });

    it('재연결 시 status 배너로 전환되고 3초 후 사라진다', async () => {
        setNavigatorOnline(false);
        render(<OfflineBanner />);
        await settle();

        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();
        });

        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('다시 연결되었습니다');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('오프라인이면서 미전송 건이 있으면 건수를 함께 알린다', async () => {
        mockGetPendingCount.mockResolvedValue(3);
        setNavigatorOnline(false);
        render(<OfflineBanner />);

        await settle();

        expect(screen.getByRole('alert')).toHaveTextContent('미전송 3건은 연결 복구 시 자동 전송됩니다');
    });

    it('연결이 돌아온 뒤에도 큐가 남아 있으면 전송 중임을 계속 알린다', async () => {
        // "다시 연결되었습니다"가 3초 만에 사라진 뒤 전송이 끝났는지 알 수 없던 구간이다.
        mockGetPendingCount.mockResolvedValue(2);
        render(<OfflineBanner />);
        await settle();

        expect(screen.getByRole('status')).toHaveTextContent('미전송 2건을 전송하는 중입니다');

        // 큐가 비면 저절로 사라진다
        mockGetPendingCount.mockResolvedValue(0);
        await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('언마운트 후에는 online/offline 이벤트에 반응하지 않는다 (리스너 해제)', async () => {
        const { unmount } = render(<OfflineBanner />);
        await settle();
        unmount();

        // 해제되지 않았다면 setState 경고(act 미적용)가 발생해 setup.ts 가드에 걸린다.
        act(() => {
            window.dispatchEvent(new Event('offline'));
            window.dispatchEvent(new Event('online'));
        });
        expect(document.querySelector('[role="alert"]')).toBeNull();
    });
});
