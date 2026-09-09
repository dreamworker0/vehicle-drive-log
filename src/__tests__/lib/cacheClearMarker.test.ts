/**
 * 로그아웃 캐시 폐기의 **미완료 표식** 계약을 고정한다.
 *
 * 이 판정은 공용 기기에서 이전 사용자의 Firestore 문서 캐시가 남는지를 가른다
 * (2026-07-10 감사 #8). 종전에는 폐기가 실패하면 경고만 남기고 넘어가, **포기한 사실이
 * 어디에도 남지 않아 캐시가 영구히 남았다.** 대표 원인은 다중 탭이다 —
 * `persistentMultipleTabManager`로 캐시를 공유하므로 다른 탭이 붙어 있으면
 * `clearIndexedDbPersistence`가 거부되고, 그 탭을 우리가 닫을 수는 없다.
 *
 * 그래서 세 가지를 못박는다. 어느 하나가 뒤집히면 **증상이 보이지 않는 채로** 캐시가 남는다.
 *  1. 시도 **전에** 표식을 적는다 (도중에 프로세스가 죽어도 미완료로 남아야 한다)
 *  2. 표식은 **성공했을 때만** 지운다 (실패를 성공으로 오해하면 영구히 남는다)
 *  3. 표식이 없으면 재시도는 **아무 일도 하지 않는다** (정상 경로에 비용 0)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    PENDING_CACHE_CLEAR_KEY,
    markCacheClearPending,
    clearCacheClearPending,
    hasCacheClearPending,
    runCacheClearWithMarker,
    runPendingCacheClear,
} from '../../lib/offline/cacheClearMarker';

const failed = () => Promise.reject(new Error('failed-precondition: 다른 탭이 캐시를 점유 중'));
const ok = () => Promise.resolve();

beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('표식 읽기·쓰기', () => {
    it('적고 지우고 확인한다', () => {
        expect(hasCacheClearPending()).toBe(false);
        markCacheClearPending();
        expect(hasCacheClearPending()).toBe(true);
        clearCacheClearPending();
        expect(hasCacheClearPending()).toBe(false);
    });

    it('저장소 접근이 막힌 환경에서도 throw 하지 않는다', () => {
        // 사생활 보호 모드·저장소 차단. 표식 때문에 로그아웃이 막히면 더 나쁘다.
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });

        expect(() => markCacheClearPending()).not.toThrow();
        expect(() => clearCacheClearPending()).not.toThrow();
        expect(hasCacheClearPending()).toBe(false); // 읽을 수 없으면 '없음'으로 본다
    });
});

describe('runCacheClearWithMarker — 로그아웃 경로', () => {
    it('성공하면 표식이 남지 않는다', async () => {
        const onError = vi.fn();

        await runCacheClearWithMarker(ok, ok, onError);

        expect(hasCacheClearPending()).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    it('폐기가 실패하면 표식을 남기고 로그아웃은 계속 진행한다', async () => {
        const onError = vi.fn();

        // throw 하지 않아야 한다 — 로그아웃 흐름을 막으면 안 된다.
        await expect(runCacheClearWithMarker(ok, failed, onError)).resolves.toBeUndefined();

        expect(hasCacheClearPending()).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('terminate가 실패해도 표식을 남긴다', async () => {
        const clearFn = vi.fn(ok);

        await runCacheClearWithMarker(failed, clearFn, vi.fn());

        expect(hasCacheClearPending()).toBe(true);
        expect(clearFn).not.toHaveBeenCalled(); // 종료되지 않은 인스턴스는 폐기할 수 없다
    });

    it('시도 전에 표식을 적는다 — 도중에 죽어도 미완료로 남는다', async () => {
        let markedWhenClearRan = false;

        await runCacheClearWithMarker(
            ok,
            () => { markedWhenClearRan = hasCacheClearPending(); return ok(); },
            vi.fn(),
        );

        expect(markedWhenClearRan).toBe(true);
    });

    it('terminate → clear 순서를 지킨다', async () => {
        const order: string[] = [];

        await runCacheClearWithMarker(
            () => { order.push('terminate'); return ok(); },
            () => { order.push('clear'); return ok(); },
            vi.fn(),
        );

        expect(order).toEqual(['terminate', 'clear']);
    });
});

describe('runPendingCacheClear — 부팅 경로', () => {
    it('표식이 없으면 아무 일도 하지 않는다 (정상 경로 비용 0)', async () => {
        const clearFn = vi.fn(ok);

        expect(await runPendingCacheClear(clearFn, vi.fn())).toBe('skipped');
        expect(clearFn).not.toHaveBeenCalled();
    });

    it('표식이 있으면 정리하고 표식을 지운다', async () => {
        markCacheClearPending();

        expect(await runPendingCacheClear(ok, vi.fn())).toBe('cleared');
        expect(hasCacheClearPending()).toBe(false);
    });

    it('다시 실패하면 표식을 남긴다 — 다음 부팅이 이어받는다', async () => {
        markCacheClearPending();
        const onError = vi.fn();

        expect(await runPendingCacheClear(failed, onError)).toBe('failed');
        expect(hasCacheClearPending()).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('여러 번 실패해도 계속 들고 있다 (다른 탭이 닫힐 때까지)', async () => {
        markCacheClearPending();

        await runPendingCacheClear(failed, vi.fn());
        await runPendingCacheClear(failed, vi.fn());
        expect(hasCacheClearPending()).toBe(true);

        // 다른 탭이 닫힌 부팅에서 드디어 성공한다
        expect(await runPendingCacheClear(ok, vi.fn())).toBe('cleared');
        expect(hasCacheClearPending()).toBe(false);
    });

    it('표식 키는 localStorage에 둔다 — 브라우저 재시작을 넘겨야 한다', () => {
        markCacheClearPending();

        // sessionStorage로 옮기면 브라우저를 닫는 순간 사라져, 다중 탭이 풀린 바로 그
        // 부팅에서 정리 기회를 잃는다.
        expect(localStorage.getItem(PENDING_CACHE_CLEAR_KEY)).not.toBeNull();
        expect(sessionStorage.getItem(PENDING_CACHE_CLEAR_KEY)).toBeNull();
    });
});
