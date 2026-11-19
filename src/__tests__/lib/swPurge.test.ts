/**
 * public/sw-purge.js — 긴급 퍼지 킬 스위치
 *
 * 표식(sw_purge_v)이 없는 브라우저에서 **지울 워커·캐시가 있을 때만** 지우고 새로고침한다.
 * 예전에는 처음 들어온 방문자도 지울 것 없이 1초 뒤 새로고침돼, 첫 화면이 뜬 직후 페이지가
 * 통째로 다시 불렸다(E2E `input-zoom.spec.ts`가 master CI에서 "Execution context was
 * destroyed"로 간헐 실패한 원인). 반대로 옛 워커가 남은 사용자는 여전히 퍼지·새로고침돼야 한다.
 */
import { describe, it, expect, vi } from 'vitest';
import SOURCE from '../../../public/sw-purge.js?raw';

interface Env {
    regs?: Array<{ unregister: () => void }> | 'reject';
    cacheNames?: string[] | 'reject';
    dbs?: string[];
    stored?: string;
}

async function runPurge(env: Env) {
    const store = new Map<string, string>();
    if (env.stored) store.set('sw_purge_v', env.stored);
    const localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
    };
    const navigator = {
        serviceWorker: {
            getRegistrations: () => (env.regs === 'reject'
                ? Promise.reject(new Error('SecurityError'))
                : Promise.resolve(env.regs ?? [])),
        },
    };
    const cachesDelete = vi.fn();
    const caches = {
        keys: () => (env.cacheNames === 'reject'
            ? Promise.reject(new Error('SecurityError'))
            : Promise.resolve(env.cacheNames ?? [])),
        delete: cachesDelete,
    };
    const deleteDatabase = vi.fn();
    const indexedDB = {
        databases: () => Promise.resolve((env.dbs ?? []).map((name) => ({ name }))),
        deleteDatabase,
    };
    const window = { caches, indexedDB };
    const reload = vi.fn();
    const timers: Array<() => void> = [];
    const fakeSetTimeout = (fn: () => void) => { timers.push(fn); };

    new Function('localStorage', 'navigator', 'window', 'caches', 'indexedDB', 'location', 'setTimeout', SOURCE)(
        localStorage, navigator, window, caches, indexedDB, { reload }, fakeSetTimeout,
    );
    // 스크립트 안의 프라미스 사슬을 끝까지 흘려보낸다
    for (let i = 0; i < 5; i++) await Promise.resolve();
    timers.forEach((fn) => fn());

    return { store, reload, cachesDelete, deleteDatabase };
}

describe('sw-purge.js', () => {
    it('처음 들어온 브라우저(워커·캐시 없음)는 표식만 남기고 새로고침하지 않는다', async () => {
        const r = await runPurge({});
        expect(r.reload).not.toHaveBeenCalled();
        expect(r.store.get('sw_purge_v')).toBe('4');
    });

    it('옛 워커가 남아 있으면 등록을 해제하고 새로고침한다', async () => {
        const unregister = vi.fn();
        const r = await runPurge({ regs: [{ unregister }], dbs: ['workbox-expiration', 'sync-db', 'firestore/x'] });
        expect(unregister).toHaveBeenCalledOnce();
        expect(r.reload).toHaveBeenCalledOnce();
        // 오프라인 쓰기 큐·Firestore 캐시는 보존한다
        expect(r.deleteDatabase.mock.calls.map((c) => c[0])).toEqual(['workbox-expiration']);
    });

    it('캐시만 남아 있어도 지우고 새로고침한다', async () => {
        const r = await runPurge({ cacheNames: ['workbox-precache-v2'] });
        expect(r.cachesDelete).toHaveBeenCalledWith('workbox-precache-v2');
        expect(r.reload).toHaveBeenCalledOnce();
    });

    it('조회가 실패해 있는지 알 수 없으면 예전처럼 퍼지·새로고침한다', async () => {
        const r = await runPurge({ regs: 'reject' });
        expect(r.reload).toHaveBeenCalledOnce();
    });

    it('이미 이번 버전으로 퍼지한 브라우저는 아무것도 하지 않는다', async () => {
        const unregister = vi.fn();
        const r = await runPurge({ stored: '4', regs: [{ unregister }] });
        expect(unregister).not.toHaveBeenCalled();
        expect(r.reload).not.toHaveBeenCalled();
    });
});
