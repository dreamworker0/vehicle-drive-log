import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isUpdateReady,
    markUpdateReady,
    reloadToLatest,
    resetUpdateReadyForTest,
    subscribeUpdateReady,
} from '../../lib/pendingUpdate';
import { reloadPage } from '../../lib/browserNav';

vi.mock('../../lib/browserNav', () => ({ reloadPage: vi.fn(), navigateTo: vi.fn(), currentHref: vi.fn(() => '') }));

/**
 * 새 버전 대기 표시와 "새 버전으로 열기"의 계약을 고정한다.
 * 안내 띠·화면 이동 적용·오류 경계 안내가 모두 이 두 가지에 기대고 있다.
 */
function setServiceWorker(value: unknown) {
    Object.defineProperty(window.navigator, 'serviceWorker', { value, configurable: true });
}

describe('새 버전 대기 표시', () => {
    beforeEach(() => resetUpdateReadyForTest());

    it('처음에는 표시가 없고, 표시하면 구독자에게 한 번만 알린다', () => {
        const listener = vi.fn();
        subscribeUpdateReady(listener);
        expect(isUpdateReady()).toBe(false);

        markUpdateReady();
        markUpdateReady(); // 여러 탭·이벤트에서 겹쳐 불려도 한 번
        expect(isUpdateReady()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('구독을 해제하면 더 이상 알리지 않는다', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeUpdateReady(listener);
        unsubscribe();
        markUpdateReady();
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('reloadToLatest — 새 버전으로 열기', () => {
    beforeEach(() => {
        vi.mocked(reloadPage).mockClear();
    });
    afterEach(() => {
        setServiceWorker(undefined);
        vi.useRealTimers();
    });

    it('서비스 워커 업데이트를 먼저 확인한 뒤 새로고침한다 — 옛 워커가 옛 화면을 다시 내주지 않게', async () => {
        const order: string[] = [];
        const update = vi.fn(async () => { order.push('update'); });
        vi.mocked(reloadPage).mockImplementation(() => { order.push('reload'); });
        setServiceWorker({ getRegistration: vi.fn(async () => ({ update })) });

        await reloadToLatest();

        expect(order).toEqual(['update', 'reload']);
    });

    it('업데이트 확인이 실패해도 새로고침은 한다', async () => {
        setServiceWorker({ getRegistration: vi.fn(async () => ({ update: vi.fn(async () => { throw new Error('offline'); }) })) });
        await reloadToLatest();
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('서비스 워커가 없는 브라우저에서도 새로고침한다', async () => {
        setServiceWorker(undefined);
        await reloadToLatest();
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('업데이트 확인이 끝나지 않아도 3초 뒤에는 새로고침한다 — 버튼이 멈춘 것처럼 보이지 않게', async () => {
        vi.useFakeTimers();
        setServiceWorker({ getRegistration: vi.fn(async () => ({ update: () => new Promise(() => { /* 응답 없음 */ }) })) });

        const done = reloadToLatest();
        await vi.advanceTimersByTimeAsync(2999);
        expect(reloadPage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(reloadPage).toHaveBeenCalledTimes(1);
    });
});
