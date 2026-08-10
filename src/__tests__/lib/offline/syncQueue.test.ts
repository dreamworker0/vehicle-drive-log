import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// firebase/firestore 쓰기와 db 인스턴스를 목으로 대체 — flushQueue의 큐 처리 계약만 검증한다.
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
        serverTimestamp: vi.fn(() => new FieldValue('serverTimestamp')),
        FieldValue,
        Timestamp,
    };
});
vi.mock('@/lib/firebase', () => ({ db: {} }));

import { enqueue, clearQueue, flushQueue, getSyncDB, drainFailedRecords, SERVER_TIMESTAMP_MARKER } from '@/lib/offline/syncQueue';
import { setDoc, updateDoc, deleteDoc, serverTimestamp, FieldValue, Timestamp } from 'firebase/firestore';

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

    it('serverTimestamp 센티널은 마커로 저장되고 flush 시 센티널로 복원된다', async () => {
        // FieldValue 인스턴스를 그대로 structuredClone하면 프로토타입이 소실되어
        // flush 재생 시 빈 맵 필드로 기록되는 결함의 회귀 가드.
        await enqueue('CREATE', 'driveLogs', 'ts1', {
            distance: 5,
            createdAt: serverTimestamp(),
            nested: { editedAt: serverTimestamp() },
        });

        // 저장 형태: 센티널이 아니라 마커 문자열이어야 한다
        const database = await getSyncDB();
        const [stored] = await database.getAll('sync-store');
        expect(stored.data?.createdAt).toBe(SERVER_TIMESTAMP_MARKER);
        expect((stored.data?.nested as Record<string, unknown>).editedAt).toBe(SERVER_TIMESTAMP_MARKER);

        await flushQueue();

        // 재생 형태: setDoc에는 복원된 FieldValue 센티널이 전달되어야 한다
        const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.createdAt).toBeInstanceOf(FieldValue);
        expect((payload.nested as Record<string, unknown>).editedAt).toBeInstanceOf(FieldValue);
        expect(payload.distance).toBe(5);
    });

    it('Firestore Timestamp는 저장 시 Date로 변환된다', async () => {
        await enqueue('CREATE', 'driveLogs', 'ts2', { timestamp: new Timestamp(1_700_000_000, 0) });

        const database = await getSyncDB();
        const [stored] = await database.getAll('sync-store');
        expect(stored.data?.timestamp).toBeInstanceOf(Date);
        expect((stored.data?.timestamp as Date).getTime()).toBe(1_700_000_000_000);
    });

    it('영구 오류(permission-denied)는 재시도 없이 즉시 폐기한다', async () => {
        await enqueue('UPDATE', 'driveLogs', 'denied', { distance: 1 });
        const permErr = Object.assign(new Error('denied'), { code: 'permission-denied' });
        vi.mocked(updateDoc).mockRejectedValue(permErr);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        expect(await allDocIds()).toEqual([]);
    });

    it('폐기된 항목은 유실 기록으로 남아 사용자에게 알릴 수 있다 — 영구 오류', async () => {
        // 폐기가 콘솔에만 남으면 운전자는 오프라인에서 쓴 기록이 사라진 걸 모른다.
        await enqueue('UPDATE', 'driveLogs', 'denied', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        const failed = await drainFailedRecords();
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ docId: 'denied', collection: 'driveLogs', reason: 'permanent', code: 'permission-denied' });
        // 한 번 알린 유실은 다시 알리지 않는다(drain은 읽으면서 비운다)
        expect(await drainFailedRecords()).toEqual([]);
    });

    it('폐기된 항목은 유실 기록으로 남는다 — 재시도 소진', async () => {
        await enqueue('UPDATE', 'driveLogs', 'poison', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(new Error('unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        for (let i = 0; i < 5; i++) await flushQueue();

        const failed = await drainFailedRecords();
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ docId: 'poison', reason: 'retry-exhausted' });
    });

    it('clearQueue는 유실 기록도 비운다 — 공용 기기에서 남의 유실 안내가 뜨면 안 된다', async () => {
        await enqueue('UPDATE', 'driveLogs', 'denied', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await flushQueue();

        await clearQueue();

        expect(await drainFailedRecords()).toEqual([]);
    });

    it('겹친 flush 호출은 같은 실행을 공유한다 — 폐기 안내가 빈 큐를 보지 않도록', async () => {
        await enqueue('CREATE', 'driveLogs', 'once', { distance: 1 });

        await Promise.all([flushQueue(), flushQueue()]);

        // 두 번째 호출이 즉시 반환해 버리면 호출자는 아직 시작도 안 한 flush를 끝난 것으로 본다.
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(await allDocIds()).toEqual([]);
    });

    it('일시 오류는 재시도 상한(5회) 도달 시 폐기한다 — poison message 방지', async () => {
        await enqueue('UPDATE', 'driveLogs', 'poison', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(new Error('unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        for (let i = 0; i < 4; i++) {
            await flushQueue();
            expect(await allDocIds()).toEqual(['poison']);
        }
        await flushQueue(); // 5번째 실패에서 폐기
        expect(await allDocIds()).toEqual([]);
    });
});
