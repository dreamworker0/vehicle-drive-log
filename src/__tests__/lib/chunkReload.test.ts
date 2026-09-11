import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { noteChunkLoadSuccess, retryOnceForNewBuild } from '@/lib/chunkReload';

const RETRY_KEY = 'chunk-reload-retried';

const reload = vi.fn();
let originalLocation: Location;

/** 리로드는 마이크로태스크 뒤에 일어난다(서비스워커 교체를 기다린 뒤). */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/** 서비스워커 컨테이너를 심는다. controller가 없으면 기다릴 것이 없는 경로다. */
function stubServiceWorker(options: { controlled: boolean; onUpdate?: () => void }) {
    const listeners: Array<() => void> = [];
    const container = {
        controller: options.controlled ? {} : null,
        getRegistration: vi.fn(async () => ({
            update: vi.fn(async () => { options.onUpdate?.(); }),
        })),
        addEventListener: vi.fn((_event: string, handler: () => void) => { listeners.push(handler); }),
        /** 새 워커가 제어권을 가져간 것을 흉내낸다. */
        fireControllerChange: () => listeners.forEach((h) => h()),
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    return container;
}

beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload },
    });
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.useRealTimers();
});

describe('chunkReload — 새 배포 뒤 옛 청크 복구', () => {
    it('첫 실패는 새로고침을 예약한다', async () => {
        stubServiceWorker({ controlled: false });

        expect(retryOnceForNewBuild()).toBe(true);
        await flush();

        expect(reload).toHaveBeenCalledTimes(1);
    });

    /**
     * 리로드해도 계속 실패하면 무한 리로드가 된다. 예산이 세션을 넘겨 살아남아야
     * 두 번째 실패에서 호출부가 에러를 드러낼 수 있다.
     */
    it('두 번째 실패는 재시도하지 않는다 (무한 리로드 방지)', async () => {
        stubServiceWorker({ controlled: false });

        expect(retryOnceForNewBuild()).toBe(true);
        await flush();
        reload.mockClear();

        expect(retryOnceForNewBuild()).toBe(false);
        await flush();
        expect(reload).not.toHaveBeenCalled();
    });

    it('예산은 새로고침을 넘겨 살아남는다 (sessionStorage에 남는다)', () => {
        stubServiceWorker({ controlled: false });

        retryOnceForNewBuild();

        expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');
    });

    /**
     * 오래 열어 둔 탭이 두 번째 배포를 만나면 다시 한 번 복구할 수 있어야 한다 —
     * 예산을 세션 내내 들고 있으면 그때 곧바로 에러 화면으로 떨어진다.
     */
    it('로드에 성공하면 예산이 돌아온다', async () => {
        stubServiceWorker({ controlled: false });

        retryOnceForNewBuild();
        noteChunkLoadSuccess();
        await flush();
        reload.mockClear();

        expect(retryOnceForNewBuild()).toBe(true);
    });

    /**
     * 예산을 기억하지 못하는 채로 리로드하면 그것이 곧 무한 루프다.
     * 복구를 포기하는 쪽이 맞다.
     */
    it('저장소를 못 쓰면 재시도하지 않는다', async () => {
        stubServiceWorker({ controlled: false });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        expect(retryOnceForNewBuild()).toBe(false);
        await flush();
        expect(reload).not.toHaveBeenCalled();

        setItem.mockRestore();
    });

    /**
     * 새 워커가 활성화되기 전에 리로드하면 **같은 옛 셸**이 다시 나와, 한 번뿐인 예산만
     * 쓰고 끝난다. sw.ts가 skipWaiting을 부르므로 곧 controllerchange가 온다.
     */
    it('서비스워커가 제어 중이면 워커 교체를 기다렸다가 새로고침한다', async () => {
        const container = stubServiceWorker({ controlled: true });

        expect(retryOnceForNewBuild()).toBe(true);
        await flush();

        // 아직 교체되지 않았으므로 리로드하지 않았다
        expect(container.getRegistration).toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();

        container.fireControllerChange();
        await flush();

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('워커가 끝내 교체되지 않아도 상한이 지나면 새로고침한다', async () => {
        vi.useFakeTimers();
        stubServiceWorker({ controlled: true });

        retryOnceForNewBuild();
        await vi.advanceTimersByTimeAsync(3100);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('워커 조회가 실패해도 새로고침은 한다', async () => {
        const container = stubServiceWorker({ controlled: true });
        container.getRegistration.mockRejectedValueOnce(new Error('보안 오류'));

        retryOnceForNewBuild();
        await flush();

        expect(reload).toHaveBeenCalledTimes(1);
    });
});
