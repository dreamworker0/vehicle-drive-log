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
        deleteField: vi.fn(() => new FieldValue('deleteField')),
        FieldValue,
        Timestamp,
    };
});
vi.mock('@/lib/firebase', () => ({ db: {} }));

import { enqueue, clearQueue, flushQueue, getSyncDB, peekFailedRecords, clearFailedRecords, getPendingCount, retryCooldownMs, SERVER_TIMESTAMP_MARKER, DELETE_FIELD_MARKER } from '@/lib/offline/syncQueue';
import { setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField, FieldValue, Timestamp } from 'firebase/firestore';

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

    it('getPendingCount는 아직 못 올린 항목만 센다', async () => {
        expect(await getPendingCount()).toBe(0);

        await enqueue('CREATE', 'driveLogs', 'a', { distance: 1 });
        await enqueue('CREATE', 'driveLogs', 'b', { distance: 2 });
        expect(await getPendingCount()).toBe(2);

        await flushQueue();
        expect(await getPendingCount()).toBe(0); // 올라간 것은 세지 않는다
    });

    it('getPendingCount는 폐기된 항목을 세지 않는다 — 유실은 "전송 대기"가 아니다', async () => {
        await enqueue('UPDATE', 'driveLogs', 'denied', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        expect(await getPendingCount()).toBe(0);
        expect(await peekFailedRecords()).toHaveLength(1);
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

    it('deleteField 센티널은 serverTimestamp로 뒤바뀌지 않는다', async () => {
        // 예전에는 FieldValue를 전부 serverTimestamp 마커로 뭉뚱그렸다. 운행일지 수정이
        // deleteField()로 출발일을 지우기 시작하면서, 오프라인 수정이 재생될 때
        // **날짜 문자열 자리에 타임스탬프가 박혔다.**
        await enqueue('UPDATE', 'driveLogs', 'del1', {
            notes: '수정',
            startDate: deleteField(),
            createdAt: serverTimestamp(),
        });

        const database = await getSyncDB();
        const [stored] = await database.getAll('sync-store');
        expect(stored.data?.startDate).toBe(DELETE_FIELD_MARKER);
        expect(stored.data?.createdAt).toBe(SERVER_TIMESTAMP_MARKER);
        expect(DELETE_FIELD_MARKER).not.toBe(SERVER_TIMESTAMP_MARKER);

        await flushQueue();

        const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
        expect((payload.startDate as { _methodName: string })._methodName).toBe('deleteField');
        expect((payload.createdAt as { _methodName: string })._methodName).toBe('serverTimestamp');
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

        const failed = await peekFailedRecords();
        await clearFailedRecords();
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ docId: 'denied', collection: 'driveLogs', reason: 'permanent', code: 'permission-denied' });
        // 한 번 알린 유실은 다시 알리지 않는다(drain은 읽으면서 비운다)
        expect(await peekFailedRecords()).toEqual([]);
    });

    it('폐기된 항목은 유실 기록으로 남는다 — 재시도 소진', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await enqueue('UPDATE', 'driveLogs', 'poison', { distance: 1 });
            vi.mocked(updateDoc).mockRejectedValue(new Error('unavailable'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            // 냉각을 넘겨 가며 5회 시도한다(즉시 5번 돌리면 냉각에 막혀 폐기되지 않는다)
            for (let i = 1; i <= 5; i++) {
                await flushQueue();
                vi.setSystemTime(Date.now() + retryCooldownMs(i) + 1);
            }

            const failed = await peekFailedRecords();
        await clearFailedRecords();
            expect(failed).toHaveLength(1);
            expect(failed[0]).toMatchObject({ docId: 'poison', reason: 'retry-exhausted' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('clearQueue는 유실 기록도 비운다 — 공용 기기에서 남의 유실 안내가 뜨면 안 된다', async () => {
        await enqueue('UPDATE', 'driveLogs', 'denied', { distance: 1 });
        vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await flushQueue();

        await clearQueue();

        expect(await peekFailedRecords()).toEqual([]);
    });

    it('겹친 flush 호출은 같은 실행을 공유한다 — 폐기 안내가 빈 큐를 보지 않도록', async () => {
        await enqueue('CREATE', 'driveLogs', 'once', { distance: 1 });

        await Promise.all([flushQueue(), flushQueue()]);

        // 두 번째 호출이 즉시 반환해 버리면 호출자는 아직 시작도 안 한 flush를 끝난 것으로 본다.
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(await allDocIds()).toEqual([]);
    });

    it('일시 오류는 재시도 상한(5회) 도달 시 폐기한다 — poison message 방지', async () => {
        // 냉각 시간이 있으므로 시도 사이에 시계를 넘겨야 실제로 재시도가 일어난다.
        // (Date만 가짜로 만든다 — setTimeout까지 가짜면 fake-indexeddb가 멈춘다)
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await enqueue('UPDATE', 'driveLogs', 'poison', { distance: 1 });
            vi.mocked(updateDoc).mockRejectedValue(new Error('unavailable'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            for (let i = 1; i <= 4; i++) {
                await flushQueue();
                expect(await allDocIds()).toEqual(['poison']);
                vi.setSystemTime(Date.now() + retryCooldownMs(i) + 1);
            }
            await flushQueue(); // 5번째 실패에서 폐기
            expect(await allDocIds()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('연결이 깜빡여도 재시도 횟수를 소모하지 않는다 — 냉각 중에는 건너뛴다', async () => {
        // 지하철·엘리베이터에서 online 이벤트가 연달아 나면 flush도 연달아 돈다. 냉각이 없으면
        // 1~2분 안에 5회가 소진돼, 조금 더 기다리면 올라갈 수 있었던 기록이 폐기됐다.
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await enqueue('UPDATE', 'driveLogs', 'flaky', { distance: 1 });
            vi.mocked(updateDoc).mockRejectedValue(new Error('unavailable'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await flushQueue();                       // 1회 실패 → 1분 냉각
            expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);

            for (let i = 0; i < 20; i++) {
                vi.setSystemTime(Date.now() + 2000);  // 2초마다 연결이 깜빡인다
                await flushQueue();
            }

            // 냉각 중이라 재시도가 아예 일어나지 않았다 — 호출 수도, 항목도 그대로다
            expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);
            expect(await allDocIds()).toEqual(['flaky']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('냉각이 끝나면 다시 시도한다', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await enqueue('UPDATE', 'driveLogs', 'later', { distance: 1 });
            vi.mocked(updateDoc).mockRejectedValueOnce(new Error('unavailable'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await flushQueue();
            expect(await allDocIds()).toEqual(['later']);

            vi.setSystemTime(Date.now() + retryCooldownMs(1) + 1);
            vi.mocked(updateDoc).mockResolvedValueOnce(undefined); // 이번엔 성공
            await flushQueue();

            expect(await allDocIds()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    // ── 문서 단위 순서 보존 ──
    // getAll은 autoIncrement 키 순서(= 적재 순서)로 돌려주지만, 선행 항목을 건너뛰고 후속만
    // 보내면 그 순서가 깨진다. 아래 4건이 "선행이 큐에 남아 있는 동안 후속을 보내지 않는다"를 고정한다.

    it('선행 CREATE가 냉각 중이면 같은 문서의 UPDATE를 보내지 않는다 — 도착 km 유실 방지', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            // 오프라인에서 운행일지 생성 → 도착 km 입력. 두 항목이 순서대로 쌓인다.
            await enqueue('CREATE', 'driveLogs', 'LOG1', { startKm: 100 });
            await enqueue('UPDATE', 'driveLogs', 'LOG1', { endKm: 150 });

            // 신호가 깜빡이는 지점: CREATE는 일시 오류, UPDATE는 아직 없는 문서라 not-found
            vi.mocked(setDoc).mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
            vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('missing'), { code: 'not-found' }));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await flushQueue();

            // UPDATE는 전송 시도조차 하지 않는다 — not-found로 즉시 폐기되던 경로가 막혔다
            expect(vi.mocked(updateDoc)).not.toHaveBeenCalled();
            expect(await peekFailedRecords()).toEqual([]);   // 유실 없음
            expect(await allDocIds()).toEqual(['LOG1', 'LOG1']); // 둘 다 큐에 보존

            // 냉각이 끝나고 연결이 회복되면 순서대로 올라간다
            vi.setSystemTime(Date.now() + retryCooldownMs(1) + 1);
            vi.mocked(setDoc).mockResolvedValue(undefined);
            vi.mocked(updateDoc).mockResolvedValue(undefined);
            await flushQueue();

            expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);
            expect(await allDocIds()).toEqual([]);
            expect(await getPendingCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('선행 CREATE가 냉각 중이면 같은 문서의 DELETE도 보내지 않는다 — 지운 문서가 되살아나지 않게', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            await enqueue('CREATE', 'driveLogs', 'LOG2', { startKm: 10 });
            await enqueue('DELETE', 'driveLogs', 'LOG2', null);

            vi.mocked(setDoc).mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await flushQueue();

            // DELETE는 없는 문서에도 성공하므로, 앞질러 보내면 큐에서 사라진 뒤
            // 뒤늦게 올라간 CREATE가 문서를 되살린다
            expect(vi.mocked(deleteDoc)).not.toHaveBeenCalled();
            expect(await allDocIds()).toEqual(['LOG2', 'LOG2']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('다른 문서는 서로를 막지 않는다 — 한 건이 냉각이어도 나머지는 올라간다', async () => {
        await enqueue('CREATE', 'driveLogs', 'STUCK', { startKm: 1 });
        await enqueue('CREATE', 'driveLogs', 'OTHER', { startKm: 2 });

        vi.mocked(setDoc)
            .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
            .mockResolvedValueOnce(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        // 막힌 문서만 남는다
        expect(await allDocIds()).toEqual(['STUCK']);
    });

    it('선행이 영구 오류로 폐기되면 후속도 같이 폐기한다 — 닿을 곳 없는 항목을 31분간 붙잡지 않는다', async () => {
        await enqueue('CREATE', 'driveLogs', 'DENIED', { startKm: 1 });
        await enqueue('UPDATE', 'driveLogs', 'DENIED', { endKm: 2 });

        vi.mocked(setDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        vi.mocked(updateDoc).mockRejectedValue(Object.assign(new Error('missing'), { code: 'not-found' }));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await flushQueue();

        // 선행이 영영 반영되지 않으므로 후속도 즉시 폐기 — 사용자에게 정확한 사유로 바로 알린다
        expect(await allDocIds()).toEqual([]);
        const failed = await peekFailedRecords();
        await clearFailedRecords();
        expect(failed).toHaveLength(2);
        expect(failed.map((f) => f.type)).toEqual(['CREATE', 'UPDATE']);
        expect(failed.every((f) => f.reason === 'permanent')).toBe(true);
    });

    it('냉각은 실패할수록 길어지고 상한을 넘지 않는다', () => {
        expect(retryCooldownMs(0)).toBe(0);          // 첫 시도는 즉시
        expect(retryCooldownMs(1)).toBe(60_000);     // 1분
        expect(retryCooldownMs(2)).toBe(120_000);
        expect(retryCooldownMs(4)).toBe(480_000);
        expect(retryCooldownMs(50)).toBe(30 * 60_000); // 상한
    });
});
