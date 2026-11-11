import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 장부 모듈의 계약만 검증한다 — 저장은 Firestore SDK가 하고, 이 모듈은 "서버 확인 전" 쓰기를 적고
// 결과에 따라 정리하며, 다음 실행에서 서버와 대조한다(syncQueue 머리 주석).
// FieldValue/Timestamp는 instanceof 판별에 쓰이므로 실제 클래스 형태로 목을 만든다.
vi.mock('firebase/firestore', () => {
    class FieldValue {
        constructor(public _methodName: string) {}
    }
    class Timestamp {
        constructor(public seconds: number, public nanoseconds: number) {}
        toDate() { return new Date(this.seconds * 1000); }
    }
    return {
        doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
        setDoc: vi.fn(() => Promise.resolve()),
        updateDoc: vi.fn(() => Promise.resolve()),
        deleteDoc: vi.fn(() => Promise.resolve()),
        getDocFromServer: vi.fn(async () => ({ exists: () => true })),
        waitForPendingWrites: vi.fn(async () => undefined),
        serverTimestamp: vi.fn(() => new FieldValue('serverTimestamp')),
        deleteField: vi.fn(() => new FieldValue('deleteField')),
        FieldValue,
        Timestamp,
    };
});
vi.mock('@/lib/firebase', () => ({ db: {} }));

import {
    trackWrite, reconcileLedger, clearQueue, getSyncDB, peekFailedRecords, clearFailedRecords, getPendingCount,
    SERVER_TIMESTAMP_MARKER, DELETE_FIELD_MARKER,
} from '@/lib/offline/syncQueue';
import { setDoc, updateDoc, deleteDoc, getDocFromServer, waitForPendingWrites, serverTimestamp, deleteField, Timestamp } from 'firebase/firestore';

/** 비동기 정리(결과 반영·장부 삭제)가 끝날 때까지 기다린다 */
const settle = () => new Promise((r) => setTimeout(r, 20));

/** 결과를 손으로 정하는 쓰기 */
function deferred() {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

async function ledgerDocIds(): Promise<string[]> {
    const database = await getSyncDB();
    return (await database.getAll('sync-store')).map((r) => r.docId);
}

/** 지난 실행에서 확인을 받지 못한 줄(옛 큐 항목 포함)을 장부에 넣는다 */
async function seedOrphan(type: 'CREATE' | 'UPDATE' | 'DELETE', docId: string, ageMs = 5 * 60_000) {
    const database = await getSyncDB();
    await database.add('sync-store', {
        type, collection: 'driveLogs', docId, data: { startKm: 100, endKm: 150 }, timestamp: Date.now() - ageMs,
    });
}

describe('trackWrite — 쓰기마다 장부에 적고 결과로 정리한다', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await clearQueue();
    });
    afterEach(() => vi.restoreAllMocks());

    it('서버 확인 전에는 미전송으로 세고, 확인되면 지운다', async () => {
        const write = deferred();
        await trackWrite('CREATE', 'driveLogs', 'a', { startKm: 1 }, write.promise, { callerAwaits: false });
        expect(await getPendingCount()).toBe(1);

        write.resolve();
        await settle();
        expect(await getPendingCount()).toBe(0);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('직접 다시 보내지 않는다 — 저장은 SDK 한 경로다', async () => {
        await trackWrite('CREATE', 'driveLogs', 'a', { startKm: 1 }, Promise.resolve(), { callerAwaits: true });
        await trackWrite('UPDATE', 'driveLogs', 'b', { endKm: 2 }, Promise.resolve(), { callerAwaits: true });
        await trackWrite('DELETE', 'driveLogs', 'c', null, Promise.resolve(), { callerAwaits: true });
        await settle();

        expect(setDoc).not.toHaveBeenCalled();
        expect(updateDoc).not.toHaveBeenCalled();
        expect(deleteDoc).not.toHaveBeenCalled();
    });

    it('아무도 결과를 보지 못한 거부는 유실로 남긴다 — 오프라인 저장', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await trackWrite('UPDATE', 'driveLogs', 'denied', { startKm: 100, endKm: 150 }, Promise.reject(denied()), { callerAwaits: false });
        await settle();

        const failed = await peekFailedRecords();
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ docId: 'denied', reason: 'permanent', code: 'permission-denied', data: { startKm: 100, endKm: 150 } });
        expect(await getPendingCount()).toBe(0);
    });

    it('온라인 저장이 곧바로 거부되면 화면이 이미 오류를 보여 줬으므로 유실로 두 번 알리지 않는다', async () => {
        await trackWrite('CREATE', 'driveLogs', 'x', { startKm: 1 }, Promise.reject(denied()), { callerAwaits: true });
        await settle();

        expect(await peekFailedRecords()).toEqual([]);
        expect(await getPendingCount()).toBe(0);
    });

    it('온라인 저장이라도 화면이 손을 놓은 뒤(10초 넘어) 온 거부는 유실로 남긴다 — 통신이 안 되는 "온라인"', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const write = deferred();
            await trackWrite('CREATE', 'driveLogs', 'liefi', { startKm: 1 }, write.promise, { callerAwaits: true });
            vi.setSystemTime(Date.now() + 11_000);
            write.reject(denied());
            await settle();
        } finally {
            vi.useRealTimers();
        }
        expect((await peekFailedRecords()).map((f) => f.docId)).toEqual(['liefi']);
    });

    it('삭제의 거부는 유실로 알리지 않는다 — "다시 입력해 주세요"가 맞지 않는다', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await trackWrite('DELETE', 'driveLogs', 'd', null, Promise.reject(denied()), { callerAwaits: false });
        await settle();
        expect(await peekFailedRecords()).toEqual([]);
        expect(await getPendingCount()).toBe(0);
    });

    it('센티널은 마커로, Timestamp는 Date로 바꿔 적는다 — 유실 안내가 내부 객체를 보여 주지 않게', async () => {
        await trackWrite('UPDATE', 'driveLogs', 's', {
            createdAt: serverTimestamp(),
            startDate: deleteField(),
            at: new Timestamp(1_700_000_000, 0),
        }, new Promise(() => {}), { callerAwaits: false });

        const database = await getSyncDB();
        const [line] = await database.getAll('sync-store');
        expect(line.data).toMatchObject({ createdAt: SERVER_TIMESTAMP_MARKER, startDate: DELETE_FIELD_MARKER });
        // IndexedDB가 돌려준 Date는 다른 실행 영역(realm)의 것일 수 있어 instanceof 대신 태그로 본다
        expect(Object.prototype.toString.call((line.data as { at: unknown }).at)).toBe('[object Date]');
    });

    it('장부 기록이 멈춰도 저장을 붙잡지 않는다 — 1.5초 뒤 돌아간다', async () => {
        // setTimeout만 가짜로 — IndexedDB 흉내(fake-indexeddb)가 쓰는 타이머까지 멈추면 뒤 테스트가 걸린다
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const database = await getSyncDB();
            vi.spyOn(database, 'add').mockImplementation(() => new Promise(() => {}) as never);
            let done = false;
            void trackWrite('CREATE', 'driveLogs', 'slow', null, Promise.resolve(), { callerAwaits: true }).then(() => { done = true; });
            await vi.advanceTimersByTimeAsync(1_600);
            expect(done).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clearQueue는 장부와 유실 기록을 함께 비운다 — 공용 기기에서 남의 건수·안내가 뜨면 안 된다', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await trackWrite('CREATE', 'driveLogs', 'pending', null, new Promise(() => {}), { callerAwaits: false });
        await trackWrite('UPDATE', 'driveLogs', 'denied', null, Promise.reject(denied()), { callerAwaits: false });
        await settle();

        await clearQueue();

        expect(await getPendingCount()).toBe(0);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('알린 기록만 지운다 — 그 사이 들어온 유실은 남긴다', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await trackWrite('UPDATE', 'driveLogs', 'first', null, Promise.reject(denied()), { callerAwaits: false });
        await settle();
        const reported = await peekFailedRecords();

        await trackWrite('UPDATE', 'driveLogs', 'second', null, Promise.reject(denied()), { callerAwaits: false });
        await settle();
        await clearFailedRecords(reported.map((f) => f.id));

        expect((await peekFailedRecords()).map((f) => f.docId)).toEqual(['second']);
    });
});

describe('reconcileLedger — 지난 실행에 남은 줄을 서버와 대조한다', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await clearQueue();
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    });
    afterEach(() => vi.restoreAllMocks());

    it('SDK 전송이 끝나기를 기다린 뒤, 서버에 있으면 지운다', async () => {
        await seedOrphan('CREATE', 'c1');
        await seedOrphan('UPDATE', 'u1');

        await reconcileLedger();

        expect(waitForPendingWrites).toHaveBeenCalled();
        expect(getDocFromServer).toHaveBeenCalledTimes(2);
        expect(await ledgerDocIds()).toEqual([]);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('새 기록이 서버에 없으면 유실로 남긴다 — 무엇을 잃었는지(계기판)도 함께', async () => {
        vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false } as never);
        await seedOrphan('CREATE', 'lost');

        await reconcileLedger();

        const failed = await peekFailedRecords();
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ docId: 'lost', reason: 'not-applied', data: { startKm: 100, endKm: 150 } });
        expect(await ledgerDocIds()).toEqual([]);
    });

    it('삭제는 문서가 없으면 반영된 것이고, 남아 있어도 유실로 알리지 않는다', async () => {
        vi.mocked(getDocFromServer)
            .mockResolvedValueOnce({ exists: () => false } as never)
            .mockResolvedValueOnce({ exists: () => true } as never);
        await seedOrphan('DELETE', 'gone');
        await seedOrphan('DELETE', 'still-there');

        await reconcileLedger();

        expect(await ledgerDocIds()).toEqual([]);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('오프라인이면 아무것도 하지 않는다 — 서버에 물을 수 없다', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        await seedOrphan('CREATE', 'c1');

        await reconcileLedger();

        expect(getDocFromServer).not.toHaveBeenCalled();
        expect(await ledgerDocIds()).toEqual(['c1']);
    });

    it('SDK 전송이 끝나지 않으면(30초) 이번에는 확인하지 않는다 — 보내기 전에 물으면 "없다"가 정상이다', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            vi.mocked(waitForPendingWrites).mockReturnValueOnce(new Promise(() => {}));
            await seedOrphan('CREATE', 'c1');
            const run = reconcileLedger();
            await vi.advanceTimersByTimeAsync(31_000);
            await run;
        } finally {
            vi.useRealTimers();
        }
        expect(getDocFromServer).not.toHaveBeenCalled();
        expect(await ledgerDocIds()).toEqual(['c1']);
    });

    it('방금 쓴 줄(1분 미만)과 이 화면이 결과를 기다리는 줄은 확인하지 않는다 — 다른 탭·진행 중 저장', async () => {
        await seedOrphan('CREATE', 'young', 10_000);
        await trackWrite('CREATE', 'driveLogs', 'live', null, new Promise(() => {}), { callerAwaits: false });

        await reconcileLedger();

        expect(getDocFromServer).not.toHaveBeenCalled();
        expect((await ledgerDocIds()).sort()).toEqual(['live', 'young']);
    });

    it('통신 오류로 확인하지 못하면 남은 줄을 다음 계기로 넘긴다', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(getDocFromServer).mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
        await seedOrphan('CREATE', 'c1');

        await reconcileLedger();

        expect(await ledgerDocIds()).toEqual(['c1']);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('읽을 권한이 없으면 확인할 방법이 없으므로 조용히 지운다 — 소속이 바뀐 사용자 등', async () => {
        vi.mocked(getDocFromServer).mockRejectedValueOnce(denied());
        await seedOrphan('CREATE', 'c1');

        await reconcileLedger();

        expect(await ledgerDocIds()).toEqual([]);
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('옛 버전이 남긴 큐 항목(재시도 기록 포함)도 다시 보내지 않고 같은 방식으로 확인한다', async () => {
        const database = await getSyncDB();
        await database.add('sync-store', {
            type: 'CREATE', collection: 'driveLogs', docId: 'legacy', data: { startKm: 1 },
            timestamp: Date.now() - 3_600_000, retryCount: 2, lastAttemptAt: Date.now() - 60_000,
        });

        await reconcileLedger();

        expect(setDoc).not.toHaveBeenCalled();
        expect(getDocFromServer).toHaveBeenCalledTimes(1);
        expect(await ledgerDocIds()).toEqual([]);
    });

    it('겹친 호출은 같은 실행을 공유한다 — 유실 안내가 확인 전 장부를 보지 않도록', async () => {
        await seedOrphan('CREATE', 'c1');
        const a = reconcileLedger();
        const b = reconcileLedger();
        expect(a).toBe(b);
        await a;
        expect(getDocFromServer).toHaveBeenCalledTimes(1);
    });
});
