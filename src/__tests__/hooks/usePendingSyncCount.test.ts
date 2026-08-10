/**
 * usePendingSyncCount — 미전송 큐 개수 폴링
 *
 * 값 자체보다 **언제 도느냐**가 계약이다. 볼 이유가 없을 때(온라인·0건) 3초마다 IndexedDB를
 * 두드리면 그만큼이 낭비이고, 반대로 오프라인·잔여분이 있을 때 멈추면 숫자가 굳어 버린다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGetPendingCount = vi.fn<() => Promise<number>>(() => Promise.resolve(0));
vi.mock('@/lib/offline/syncQueue', () => ({
    getPendingCount: () => mockGetPendingCount(),
}));

import usePendingSyncCount from '@/hooks/usePendingSyncCount';

function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** 대기 중인 마이크로태스크를 흘려 훅의 비동기 조회를 반영시킨다 */
async function settle() {
    await act(async () => { await Promise.resolve(); });
}

/** 타이머를 ms만큼 진행시키고 그때 발생한 비동기 조회까지 반영시킨다 */
async function advance(ms: number) {
    await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
}

describe('usePendingSyncCount', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setNavigatorOnline(true);
        mockGetPendingCount.mockReset();
        mockGetPendingCount.mockResolvedValue(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('마운트 시 한 번 조회한다', async () => {
        mockGetPendingCount.mockResolvedValue(4);
        const { result } = renderHook(() => usePendingSyncCount());

        await settle();

        expect(result.current).toBe(4);
        expect(mockGetPendingCount).toHaveBeenCalledTimes(1);
    });

    it('온라인이고 남은 것이 없으면 폴링하지 않는다', async () => {
        renderHook(() => usePendingSyncCount());
        await settle();
        expect(mockGetPendingCount).toHaveBeenCalledTimes(1);

        await advance(30_000);

        expect(mockGetPendingCount).toHaveBeenCalledTimes(1); // 10회가 아니다
    });

    it('남은 것이 있으면 비워질 때까지 계속 지켜본다', async () => {
        mockGetPendingCount.mockResolvedValue(2);
        const { result } = renderHook(() => usePendingSyncCount());
        await settle();

        await advance(3000);
        expect(mockGetPendingCount).toHaveBeenCalledTimes(2);

        mockGetPendingCount.mockResolvedValue(0);
        await advance(3000);
        expect(result.current).toBe(0);

        // 0이 된 뒤에는 멈춘다
        const callsWhenDrained = mockGetPendingCount.mock.calls.length;
        await advance(30_000);
        expect(mockGetPendingCount).toHaveBeenCalledTimes(callsWhenDrained);
    });

    it('오프라인이면 남은 것이 없어도 계속 지켜본다 — 그 사이 새로 쌓이기 때문', async () => {
        setNavigatorOnline(false);
        renderHook(() => usePendingSyncCount());
        await settle();

        await advance(3000);

        expect(mockGetPendingCount).toHaveBeenCalledTimes(2);
    });

    it('오프라인 전환·온라인 복귀·화면 복귀에 즉시 다시 조회한다', async () => {
        renderHook(() => usePendingSyncCount());
        await settle();
        expect(mockGetPendingCount).toHaveBeenCalledTimes(1);

        for (const fire of [
            () => window.dispatchEvent(new Event('offline')),
            () => window.dispatchEvent(new Event('online')),
            () => document.dispatchEvent(new Event('visibilitychange')),
        ]) {
            await act(async () => { fire(); await Promise.resolve(); });
        }

        // 화면 복귀는 백그라운드 동안 SW가 큐를 비웠을 수 있어 계기가 된다
        expect(mockGetPendingCount).toHaveBeenCalledTimes(4);
    });

    it('언마운트하면 폴링과 리스너를 모두 걷는다', async () => {
        mockGetPendingCount.mockResolvedValue(2);
        const { unmount } = renderHook(() => usePendingSyncCount());
        await settle();

        unmount();
        const callsAtUnmount = mockGetPendingCount.mock.calls.length;

        await advance(30_000);
        window.dispatchEvent(new Event('online'));

        expect(mockGetPendingCount).toHaveBeenCalledTimes(callsAtUnmount);
    });
});
