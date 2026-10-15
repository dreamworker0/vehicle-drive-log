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

    it('flushQueueQuietly는 IDB를 못 쓰는 기기의 실패를 삼킨다 — 처리되지 않은 거부로 새지 않는다', async () => {
        const { flushQueueQuietly } = await loadQueue();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        openDB.mockRejectedValue(idbBackendFailure());

        await expect(flushQueueQuietly()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
    });

    it('그 밖의 flush 실패는 삼키지 않는다 — 큐가 안 비는 결함이 조용해지면 안 된다', async () => {
        // Firestore 쓰기는 됐는데 큐에서 지우기가 실패하는 부류. 삼키면 같은 문서가 매번
        // 다시 전송되고 '미전송 N건'이 영영 남는데, 그것을 알아챌 방법이 사라진다.
        const { flushQueueQuietly } = await loadQueue();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        openDB.mockRejectedValue(new Error('예상하지 못한 실패'));

        await expect(flushQueueQuietly()).rejects.toThrow('예상하지 못한 실패');

        warn.mockRestore();
    });
});

/**
 * iOS Safari는 앱이 백그라운드에 있는 동안 IDB 연결을 끊는다. 캐시된 연결은 그대로라 화면에
 * 돌아온 직후의 flush가 죽은 연결로 읽다 실패했다(Sentry JAVASCRIPT-REACT-6N, iOS 18.7 —
 * `InvalidStateError: ... The database connection is closing.` at runFlush).
 */
const connectionClosing = () => new DOMException(
    "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
    'InvalidStateError',
);

/** 모든 작업이 '닫히는 중'으로 실패하는 죽은 연결 */
const deadConnection = () => {
    const fail = vi.fn(async () => { throw connectionClosing(); });
    return { getAll: fail, add: fail, count: fail, clear: fail, delete: fail, put: fail };
};

describe('syncQueue — 브라우저가 연결을 끊었을 때', () => {
    beforeEach(() => {
        openDB.mockReset();
    });

    it('화면 복귀 flush가 죽은 연결을 만나면 새로 열어 이어 간다', async () => {
        const { getSyncDB, flushQueueQuietly } = await loadQueue();
        const fresh = { getAll: vi.fn(async () => []) };
        openDB.mockResolvedValueOnce(deadConnection()).mockResolvedValueOnce(fresh);

        await getSyncDB();  // 앱 시작 때 연 연결 — 그 뒤 백그라운드에서 끊겼다
        await expect(flushQueueQuietly()).resolves.toBeUndefined();

        expect(openDB).toHaveBeenCalledTimes(2);
        expect(fresh.getAll).toHaveBeenCalledWith('sync-store');
    });

    it('오프라인 쓰기 적재도 새 연결로 다시 한다 — 죽은 연결 때문에 기록을 잃지 않는다', async () => {
        const { getSyncDB, enqueue } = await loadQueue();
        const fresh = { add: vi.fn(async () => 1) };
        openDB.mockResolvedValueOnce(deadConnection()).mockResolvedValueOnce(fresh);

        await getSyncDB();
        await enqueue('CREATE', 'driveLogs', 'd1', { startKm: 100 });

        expect(fresh.add).toHaveBeenCalledTimes(1);
    });

    it('미전송 건수도 새 연결로 센다 — 죽은 연결이면 0으로 보였다', async () => {
        const { getSyncDB, getPendingCount } = await loadQueue();
        openDB.mockResolvedValueOnce(deadConnection()).mockResolvedValueOnce({ count: vi.fn(async () => 3) });

        await getSyncDB();
        await expect(getPendingCount()).resolves.toBe(3);
    });

    it('브라우저가 연결 종료를 알리면(terminated) 다음 호출은 새로 연다', async () => {
        const { getSyncDB } = await loadQueue();
        const first = { name: 'first' };
        const second = { name: 'second' };
        openDB.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

        await expect(getSyncDB()).resolves.toBe(first);
        const { terminated } = openDB.mock.calls[0][2] as { terminated: () => void };
        terminated();

        await expect(getSyncDB()).resolves.toBe(second);
    });

    it('새 연결마저 닫히는 중이면 한 번만 다시 하고 조용히 넘긴다 — 처리되지 않은 거부로 새지 않는다', async () => {
        const { getSyncDB, flushQueueQuietly } = await loadQueue();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        openDB.mockResolvedValue(deadConnection());

        await getSyncDB();
        await expect(flushQueueQuietly()).resolves.toBeUndefined();

        expect(openDB).toHaveBeenCalledTimes(2);  // 처음 + 한 번 다시 — 무한히 다시 열지 않는다
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('닫힘이 아닌 실패는 다시 하지 않는다', async () => {
        const { getSyncDB, enqueue } = await loadQueue();
        openDB.mockResolvedValue({ add: vi.fn(async () => { throw new Error('QuotaExceededError'); }) });

        await getSyncDB();
        await expect(enqueue('CREATE', 'driveLogs', 'd1', null)).rejects.toThrow('QuotaExceededError');
        expect(openDB).toHaveBeenCalledTimes(1);
    });
});
