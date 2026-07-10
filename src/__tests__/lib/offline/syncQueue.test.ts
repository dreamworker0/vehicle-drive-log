import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// firebase/firestore 쓰기와 db 인스턴스를 목으로 대체 — flushQueue의 큐 처리 계약만 검증한다.
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));

import { enqueue, clearQueue, flushQueue, getSyncDB } from '@/lib/offline/syncQueue';
import { setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

async function allDocIds(): Promise<string[]> {
    const database = await getSyncDB();
    const records = await database.getAll('sync-store');
    return records.map((r) => r.docId);
}

describe('offline syncQueue', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await clearQueue();
    });

    it('enqueue가 큐에 항목을 적재하고 clearQueue가 전부 비운다', async () => {
        await enqueue('CREATE', 'driveLogs', 'a', { distance: 1 });
        await enqueue('UPDATE', 'driveLogs', 'b', { distance: 2 });
        expect(await allDocIds()).toEqual(['a', 'b']);

        await clearQueue();
        expect(await allDocIds()).toEqual([]);
    });

    it('flush는 CREATE/UPDATE/DELETE를 각 Firestore 쓰기로 매핑하고 성공 항목을 제거한다', async () => {
        await enqueue('CREATE', 'driveLogs', 'c1', { distance: 10 });
        await enqueue('UPDATE', 'driveLogs', 'u1', { distance: 20 });
        await enqueue('DELETE', 'driveLogs', 'd1', null);

        await flushQueue();

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(updateDoc).toHaveBeenCalledTimes(1);
        expect(deleteDoc).toHaveBeenCalledTimes(1);
        expect(await allDocIds()).toEqual([]);
    });

    it('flush 실패 항목은 보존하고 성공 항목만 제거한다', async () => {
        await enqueue('CREATE', 'driveLogs', 'ok', { distance: 10 });
        await enqueue('UPDATE', 'driveLogs', 'retry', { distance: 20 });
        vi.mocked(setDoc).mockResolvedValueOnce(undefined);
        vi.mocked(updateDoc).mockRejectedValueOnce(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        // 성공한 CREATE('ok')는 제거되고 실패한 UPDATE('retry')는 보존된다.
        expect(await allDocIds()).toEqual(['retry']);
    });

    it('CREATE인데 data가 없으면 setDoc를 호출하지 않는다', async () => {
        await enqueue('CREATE', 'driveLogs', 'nodata', null);
        await flushQueue();
        expect(setDoc).not.toHaveBeenCalled();
    });
});
