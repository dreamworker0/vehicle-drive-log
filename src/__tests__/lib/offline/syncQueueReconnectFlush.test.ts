import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import SW_SOURCE from '../../../sw.ts?raw';

// 장부 확인은 **페이지 한 곳에서만** 하고, **다시 보내지 않는다**는 계약을 고정한다.
//
// 예전에는 SyncManager 지원 브라우저(Android Chrome)에서 서비스워커가 큐를 비웠다. 서비스워커에는
// App Check가 없어 Firestore(App Check ENFORCED) 쓰기가 거부될 수 있었다. 지금은 페이지도 쓰지
// 않는다 — 오프라인 쓰기는 Firestore SDK가 보내고, 페이지는 서버에 반영됐는지만 확인한다.
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    getDocFromServer: vi.fn(async () => ({ exists: () => true })),
    waitForPendingWrites: vi.fn(async () => undefined),
    serverTimestamp: vi.fn(),
    deleteField: vi.fn(),
    FieldValue: class {},
    Timestamp: class {},
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));

const swContainer = new EventTarget();

/** 비동기 확인이 끝날 때까지 기다린다 */
const settle = () => new Promise((r) => setTimeout(r, 30));

// registerLedgerReconcile은 페이지 수명 동안 한 번만 등록된다(모듈 플래그). 실제 앱과 같게
// 모듈을 한 번만 불러 등록하고, 계기(시작 → online → SW 메시지)를 차례로 확인한다.
describe('registerLedgerReconcile — 페이지 단일 확인', () => {
    let queue: typeof import('@/lib/offline/syncQueue');
    let fs: typeof import('firebase/firestore');

    /** 지난 실행에서 확인을 받지 못한 줄(1분보다 오래된 줄)을 장부에 넣는다 */
    const seedOrphan = async (docId: string) => {
        const database = await queue.getSyncDB();
        await database.add('sync-store', {
            type: 'CREATE', collection: 'driveLogs', docId, data: { startKm: 1 }, timestamp: Date.now() - 5 * 60_000,
        });
    };

    beforeAll(async () => {
        Object.defineProperty(navigator, 'serviceWorker', { value: swContainer, configurable: true });
        queue = await import('@/lib/offline/syncQueue');
        fs = await import('firebase/firestore');
        await queue.clearQueue();
    });

    it('앱 시작 시 남은 줄을 서버와 대조해 지운다 — 다시 보내지 않는다', async () => {
        await seedOrphan('start-1');
        vi.mocked(fs.getDocFromServer).mockClear();

        queue.registerLedgerReconcile();
        await settle();

        expect(fs.getDocFromServer).toHaveBeenCalledTimes(1);
        expect(fs.setDoc).not.toHaveBeenCalled();
        expect(await queue.getPendingCount()).toBe(0);
    });

    it('연결이 돌아오면(online) 확인한다', async () => {
        await seedOrphan('online-1');
        vi.mocked(fs.getDocFromServer).mockClear();

        window.dispatchEvent(new Event('online'));
        await settle();

        expect(fs.getDocFromServer).toHaveBeenCalledTimes(1);
        expect(await queue.getPendingCount()).toBe(0);
    });

    it('서비스워커의 FLUSH_SYNC_QUEUE 메시지를 받으면 확인한다 (옛 버전이 등록한 Background Sync)', async () => {
        await seedOrphan('sw-1');
        vi.mocked(fs.getDocFromServer).mockClear();

        swContainer.dispatchEvent(new MessageEvent('message', { data: { type: 'FLUSH_SYNC_QUEUE' } }));
        await settle();

        expect(fs.getDocFromServer).toHaveBeenCalledTimes(1);
        expect(await queue.getPendingCount()).toBe(0);
        expect(fs.setDoc).not.toHaveBeenCalled();
    });

    it('서비스워커는 장부 모듈을 쓰지 않는다 — App Check 없는 Firestore 경로를 만들지 않는다', () => {
        expect(SW_SOURCE).not.toMatch(/from ['"][^'"]*offline\/syncQueue['"]/);
        expect(SW_SOURCE).toContain("type: 'FLUSH_SYNC_QUEUE'");
    });
});
