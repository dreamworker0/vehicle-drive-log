/**
 * offlineQueue — IndexedDB 오프라인 큐 유틸리티 테스트
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// IndexedDB mock (fake-indexeddb)
import 'fake-indexeddb/auto';

describe('offlineQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        // DB 정리
        try {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name);
            }
        } catch {
            // indexedDB.databases()가 지원되지 않는 환경에서는 무시
        }
    });

    it('enqueueLog로 항목 추가 후 getPendingCount로 개수 확인', async () => {
        const { enqueueLog, getPendingCount } = await import('../../lib/offlineQueue');

        await enqueueLog({ test: 'data1' });
        await enqueueLog({ test: 'data2' });

        const count = await getPendingCount();
        expect(count).toBe(2);
    });

    it('processQueue는 오프라인 상태에서 0 반환', async () => {
        const { processQueue } = await import('../../lib/offlineQueue');

        // navigator.onLine을 false로 설정
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

        const result = await processQueue();
        expect(result).toBe(0);

        // 복원
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    });

    it('빈 큐에서 getPendingCount는 0 반환', async () => {
        const { getPendingCount } = await import('../../lib/offlineQueue');
        const count = await getPendingCount();
        expect(count).toBe(0);
    });
});
