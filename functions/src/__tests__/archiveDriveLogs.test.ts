/**
 * archiveDriveLogs.test.ts — 운행 기록 아카이빙 스케줄러 단위 테스트
 *
 * gzip 압축, GCS 업로드, Firestore batch 삭제 로직을 검증한다.
 */

jest.setTimeout(60000);

// ── Firestore mock ──
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockGetDocs = jest.fn();

const mockBatch = () => ({
    delete: mockBatchDelete,
    commit: mockBatchCommit,
});

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({
            where: (...args: unknown[]) => {
                mockWhere(...args);
                return { limit: (n: number) => { mockLimit(n); return { get: mockGetDocs }; } };
            },
        }),
        batch: mockBatch,
    }),
}));

// ── Storage mock ──
const mockFileSave = jest.fn();
jest.mock('firebase-admin/storage', () => ({
    getStorage: () => ({
        bucket: () => ({
            name: 'test-bucket',
            file: () => ({ save: mockFileSave }),
        }),
    }),
}));

// ── helpers mock ──
jest.mock('../utils/helpers', () => ({
    log: jest.fn(),
}));

// ── scheduler mock — 핸들러 자체를 그대로 반환 ──
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: Function) => handler,
}));

import { archiveLogs as archiveDriveLogs } from "../handlers/scheduled/dailyNightlyBatch";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { log } from "../utils/helpers";

describe('archiveDriveLogs', () => {
    beforeEach(() => jest.clearAllMocks());

    it('3년 이상 된 기록이 없으면 아카이빙을 건너뛴다', async () => {
        mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

        await (archiveDriveLogs as unknown as Function)(getFirestore(), getStorage().bucket());

        expect(log).toHaveBeenCalledWith('INFO', 'dailyNightlyBatch', expect.stringContaining('스킵'));
        expect(mockFileSave).not.toHaveBeenCalled();
        expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('기록이 있으면 gzip 압축 후 GCS 저장 및 Firestore 삭제를 수행한다', async () => {
        const mockRef1 = { id: 'log1' };
        const mockRef2 = { id: 'log2' };
        const mockDocs = [
            { id: 'log1', ref: mockRef1, data: () => ({ distance: 10, timestamp: new Date() }) },
            { id: 'log2', ref: mockRef2, data: () => ({ distance: 20, timestamp: new Date() }) },
        ];
        mockGetDocs.mockResolvedValue({ empty: false, docs: mockDocs });
        mockFileSave.mockResolvedValue(undefined);
        mockBatchCommit.mockResolvedValue(undefined);

        await (archiveDriveLogs as unknown as Function)(getFirestore(), getStorage().bucket());

        // GCS에 저장 확인 (gzip된 Buffer)
        expect(mockFileSave).toHaveBeenCalledTimes(1);
        const [savedData, options] = mockFileSave.mock.calls[0];
        expect(Buffer.isBuffer(savedData)).toBe(true);
        expect(options.contentType).toBe('application/gzip');
        expect(options.metadata.recordCount).toBe('2');

        // Firestore batch 삭제 확인
        expect(mockBatchDelete).toHaveBeenCalledTimes(2);
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);

        // 완료 로그 확인
        expect(log).toHaveBeenCalledWith(
            'INFO', 'dailyNightlyBatch',
            expect.stringContaining('2건 아카이빙'),
            expect.objectContaining({ compressionRatio: expect.any(String) })
        );
    });

    it('Firestore 쿼리는 500건으로 제한한다', async () => {
        mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

        await (archiveDriveLogs as unknown as Function)(getFirestore(), getStorage().bucket());

        expect(mockLimit).toHaveBeenCalledWith(500);
    });

    it('3년 전 기준으로 timestamp 필터를 적용한다', async () => {
        mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

        const before = new Date();
        await (archiveDriveLogs as unknown as Function)(getFirestore(), getStorage().bucket());

        expect(mockWhere).toHaveBeenCalledWith('timestamp', '<', expect.any(Date));
        const filterDate = mockWhere.mock.calls[0][2] as Date;
        // 3년 전이므로 현재 년도 - 3
        expect(filterDate.getFullYear()).toBeLessThanOrEqual(before.getFullYear() - 3);
    });
});
