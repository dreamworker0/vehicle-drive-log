import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import SW_SOURCE from '../../../sw.ts?raw';

// 오프라인 큐 flush는 **페이지 한 곳에서만** 한다는 계약을 고정한다.
//
// 예전에는 SyncManager 지원 브라우저(Android Chrome)에서 서비스워커가 큐를 비웠다. 서비스워커에는
// App Check가 없어 Firestore(App Check ENFORCED) 쓰기가 거부될 수 있고, permission-denied는
// 영구 오류로 폐기된다. 게다가 페이지도 같은 순간 같은 큐를 비우고 있었다(잠금 없음).
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn(),
    deleteField: vi.fn(),
    FieldValue: class {},
    Timestamp: class {},
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));

const swContainer = new EventTarget();

/** 비동기 flush가 끝날 때까지 기다린다 */
const settle = () => new Promise((r) => setTimeout(r, 30));

// registerReconnectFlush는 페이지 수명 동안 한 번만 등록된다(모듈 플래그). 실제 앱과 같게
// 모듈을 한 번만 불러 등록하고, 계기(시작 → online → SW 메시지)를 차례로 확인한다.
// 모듈을 테스트마다 새로 불러오면 앞 인스턴스의 리스너가 남아 누가 flush했는지 가를 수 없다.
describe('registerReconnectFlush — 페이지 단일 flush', () => {
    let queue: typeof import('@/lib/offline/syncQueue');
    let setDoc: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        Object.defineProperty(navigator, 'serviceWorker', { value: swContainer, configurable: true });
        // Android Chrome처럼 Background Sync를 지원하는 브라우저 — 예전에는 여기서 등록을 건너뛰었다.
        (window as unknown as Record<string, unknown>).SyncManager = function SyncManager() {};
        queue = await import('@/lib/offline/syncQueue');
        setDoc = vi.mocked((await import('firebase/firestore')).setDoc) as unknown as ReturnType<typeof vi.fn>;
        await queue.clearQueue();
    });

    afterAll(() => {
        delete (window as unknown as Record<string, unknown>).SyncManager;
    });

    it('SyncManager가 있어도 앱 시작 시 페이지가 남은 항목을 올린다', async () => {
        await queue.enqueue('CREATE', 'driveLogs', 'start-1', { distance: 1 });
        setDoc.mockClear();

        queue.registerReconnectFlush();
        await settle();

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(await queue.getPendingCount()).toBe(0);
    });

    it('연결이 돌아오면(online) 페이지가 올린다', async () => {
        await queue.enqueue('CREATE', 'driveLogs', 'online-1', { distance: 1 });
        setDoc.mockClear();

        window.dispatchEvent(new Event('online'));
        await settle();

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(await queue.getPendingCount()).toBe(0);
    });

    it('서비스워커의 FLUSH_SYNC_QUEUE 메시지를 받으면 페이지가 올린다', async () => {
        await queue.enqueue('CREATE', 'driveLogs', 'sw-1', { distance: 1 });
        setDoc.mockClear();

        swContainer.dispatchEvent(new MessageEvent('message', { data: { type: 'FLUSH_SYNC_QUEUE' } }));
        await settle();

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(await queue.getPendingCount()).toBe(0);
    });

    it('서비스워커는 큐를 직접 비우지 않는다 — App Check 없는 쓰기 경로를 만들지 않는다', () => {
        expect(SW_SOURCE).not.toMatch(/from ['"][^'"]*offline\/syncQueue['"]/);
        expect(SW_SOURCE).toContain("type: 'FLUSH_SYNC_QUEUE'");
    });
});
