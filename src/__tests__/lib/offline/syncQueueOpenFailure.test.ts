/**
 * syncQueueOpenFailure — IndexedDB를 **아예 열지 못하는** 기기에서의 계약
 *
 * iOS Safari는 IDB 백엔드가 일시적으로 죽으면 여는 것부터 거부한다
 * (`UnknownError: An internal error was encountered in the Indexed Database server` —
 * Sentry JAVASCRIPT-REACT-6H, iOS 18.7 / Mobile Safari). 그때 두 가지가 문제였다.
 *
 *   1) 거부된 Promise가 캐시에 남아, 기기가 회복된 뒤에도 그 세션 내내 큐가 죽어 있었다.
 *      미전송 건수는 0으로 보이고(getPendingCount의 catch) 이후 오프라인 쓰기는 전부 실패한다.
 *   2) flush는 `online`·앱 시작 계기에서 결과를 기다리지 않고 부른다(`void`). 그래서 그
 *      거부가 **처리되지 않은 프라미스 거부**가 되어 스택 없는 오류로 Sentry에 올라왔다.
 *
 * 두 계약을 여기서 고정한다. 실패를 만들어 내야 하므로 fake-indexeddb 대신 `idb`를 목으로 둔다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openDB } = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock('idb', () => ({ openDB }));

// FieldValue/Timestamp는 syncQueue가 instanceof로 판별하므로 클래스 형태가 필요하다.
vi.mock('firebase/firestore', () => {
    class FieldValue {
        constructor(public _methodName: string) {}
    }
    class Timestamp {
        constructor(public seconds: number) {}
        toDate() { return new Date(this.seconds * 1000); }
    }
    return {
        doc: vi.fn(),
        setDoc: vi.fn(),
        updateDoc: vi.fn(),
        deleteDoc: vi.fn(),
        serverTimestamp: vi.fn(() => new FieldValue('serverTimestamp')),
        deleteField: vi.fn(() => new FieldValue('deleteField')),
        FieldValue,
        Timestamp,
    };
});
vi.mock('@/lib/firebase', () => ({ db: {} }));

/** 모듈 수준 캐시(dbPromise)를 비운 상태로 새로 불러온다 */
async function loadQueue() {
    vi.resetModules();
    return import('@/lib/offline/syncQueue');
}

const idbBackendFailure = () => new DOMException(
    'An internal error was encountered in the Indexed Database server',
    'UnknownError',
);

describe('syncQueue — IDB를 열지 못할 때', () => {
    beforeEach(() => {
        openDB.mockReset();
    });

    it('열기 실패를 캐시하지 않는다 — 기기가 회복되면 다음 호출에서 다시 연다', async () => {
        const { getSyncDB, getPendingCount } = await loadQueue();

        openDB.mockRejectedValueOnce(idbBackendFailure());
        await expect(getSyncDB()).rejects.toThrow(/Indexed Database server/);

        openDB.mockResolvedValueOnce({ count: vi.fn(async () => 2) });
        await expect(getPendingCount()).resolves.toBe(2);
        expect(openDB).toHaveBeenCalledTimes(2);
    });

    it('flushQueueQuietly는 IDB 실패를 삼킨다 — 처리되지 않은 거부로 새지 않는다', async () => {
        const { flushQueueQuietly } = await loadQueue();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        openDB.mockRejectedValue(idbBackendFailure());

        await expect(flushQueueQuietly()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
    });
});
