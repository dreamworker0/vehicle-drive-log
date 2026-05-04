/**
 * offlineSync — 통합 오프라인 큐 유틸리티 테스트
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processOfflineQueue } from '../../lib/offlineSyncProcessor';

// IndexedDB mock (fake-indexeddb)
import 'fake-indexeddb/auto';

describe('offlineSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.clearAllTimers();
        // DB 정리
        try {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name);
            }
        } catch {
            // indexedDB.databases()가 지원되지 않는 환경에서는 무시
        }
        await new Promise(r => setTimeout(r, 0)); // pending log 비우기
    });

    it('enqueueLog로 항목 추가 후 getPendingCount로 개수 확인', async () => {
        const { enqueueLog, getPendingCount } = await import('../../lib/offlineSync');

        await enqueueLog({ test: 'data1' });
        await enqueueLog({ test: 'data2' });

        const count = await getPendingCount();
        expect(count).toBe(2);
    });

    it('processOfflineQueue는 오프라인 상태에서 0 반환', async () => {
        // navigator.onLine을 false로 설정
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

        const result = await processOfflineQueue();
        expect(result).toBe(0);

        // 복원
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    });

    it('빈 큐에서 getPendingCount는 0 반환', async () => {
        const { getPendingCount } = await import('../../lib/offlineSync');
        const count = await getPendingCount();
        expect(count).toBe(0);
    });

    it('queueOfflineAction으로 항목 추가 후 getOfflineActions로 조회', async () => {
        const { queueOfflineAction, getOfflineActions } = await import('../../lib/offlineSync');

        await queueOfflineAction('CREATE_DRIVELOG', { vehicleId: 'v1' });

        const actions = await getOfflineActions();
        expect(actions.length).toBe(1);
        expect(actions[0].type).toBe('CREATE_DRIVELOG');
        expect(actions[0].retryCount).toBe(0);
    });

    it('incrementRetryCount로 재시도 횟수 증가', async () => {
        const { queueOfflineAction, getOfflineActions, incrementRetryCount } = await import('../../lib/offlineSync');

        await queueOfflineAction('UPDATE_DRIVELOG', { id: 'log1' });
        const before = await getOfflineActions();
        expect(before[0].retryCount).toBe(0);

        await incrementRetryCount(before[0].id);
        const after = await getOfflineActions();
        expect(after[0].retryCount).toBe(1);
    });

    it('removeOfflineAction으로 항목 제거', async () => {
        const { queueOfflineAction, getOfflineActions, removeOfflineAction } = await import('../../lib/offlineSync');

        await queueOfflineAction('CREATE_DRIVELOG', { vehicleId: 'v2' });
        const actions = await getOfflineActions();
        expect(actions.length).toBe(1);

        await removeOfflineAction(actions[0].id);
        const after = await getOfflineActions();
        expect(after.length).toBe(0);
    });
});
