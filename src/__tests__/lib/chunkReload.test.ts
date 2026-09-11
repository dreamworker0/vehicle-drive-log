import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { noteChunkLoadSuccess, retryOnceForNewBuild } from '@/lib/chunkReload';

const RETRY_KEY = 'chunk-reload-retried';

const reload = vi.fn();
let originalLocation: Location;

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
});

describe('chunkReload — 새 배포 뒤 옛 청크 복구', () => {
    /**
     * **동기적으로** 리로드해야 한다. 지연시키면 그 사이 시작된 네비게이션을 가로챈다 —
     * 서비스워커 활성화를 최대 3초 기다리는 안으로 썼다가 E2E에서
     * `Navigation to "/" is interrupted by another navigation to "/"`로 깨졌다.
     */
    it('첫 실패는 그 자리에서 새로고침한다', () => {
        expect(retryOnceForNewBuild()).toBe(true);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    /**
     * 리로드해도 계속 실패하면 무한 리로드가 된다. 예산이 세션을 넘겨 살아남아야
     * 두 번째 실패에서 호출부가 에러를 드러낼 수 있다.
     */
    it('두 번째 실패는 재시도하지 않는다 (무한 리로드 방지)', () => {
        expect(retryOnceForNewBuild()).toBe(true);
        reload.mockClear();

        expect(retryOnceForNewBuild()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('예산은 새로고침을 넘겨 살아남는다 (sessionStorage에 남는다)', () => {
        retryOnceForNewBuild();

        expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');
    });

    /**
     * 오래 열어 둔 탭이 두 번째 배포를 만나면 다시 한 번 복구할 수 있어야 한다 —
     * 예산을 세션 내내 들고 있으면 그때 곧바로 에러 화면으로 떨어진다.
     */
    it('로드에 성공하면 예산이 돌아온다', () => {
        retryOnceForNewBuild();
        noteChunkLoadSuccess();
        reload.mockClear();

        expect(retryOnceForNewBuild()).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    /**
     * 예산을 기억하지 못하는 채로 리로드하면 그것이 곧 무한 루프다.
     * 복구를 포기하는 쪽이 맞다.
     */
    it('저장소를 못 쓰면 재시도하지 않는다', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        expect(retryOnceForNewBuild()).toBe(false);
        expect(reload).not.toHaveBeenCalled();

        setItem.mockRestore();
    });

    it('성공 기록도 저장소가 막혀 있으면 조용히 넘어간다', () => {
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        expect(() => noteChunkLoadSuccess()).not.toThrow();

        removeItem.mockRestore();
    });
});
