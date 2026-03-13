import { cleanupExpiredRateLimits } from '../rateLimit';

// Firestore mock
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDelete = jest.fn();
const mockRunTransaction = jest.fn();
const mockBatchCommit = jest.fn();
const mockBatchDelete = jest.fn();

const mockDocRef = { id: 'test-doc' };
const mockBatch = { delete: mockBatchDelete, commit: mockBatchCommit };

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({
            doc: () => mockDocRef,
            where: () => ({
                limit: () => ({
                    get: mockGet,
                }),
            }),
        }),
        batch: () => mockBatch,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: {
        increment: (n: number) => ({ _increment: n }),
        serverTimestamp: () => ({ _serverTimestamp: true }),
    },
}));

jest.mock('firebase-functions/https', () => ({
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    },
}));

describe('rateLimit — Rate Limiting 유틸리티', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('cleanupExpiredRateLimits()', () => {
        it('만료된 문서가 없으면 0을 반환한다', async () => {
            mockGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

            const count = await cleanupExpiredRateLimits();

            expect(count).toBe(0);
            expect(mockBatchCommit).not.toHaveBeenCalled();
        });

        it('만료된 문서를 삭제하고 개수를 반환한다', async () => {
            const mockDocs = [
                { ref: { id: 'doc1' } },
                { ref: { id: 'doc2' } },
                { ref: { id: 'doc3' } },
            ];
            mockGet.mockResolvedValue({ empty: false, docs: mockDocs, size: 3 });
            mockBatchCommit.mockResolvedValue(undefined);

            const count = await cleanupExpiredRateLimits();

            expect(count).toBe(3);
            expect(mockBatchDelete).toHaveBeenCalledTimes(3);
            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
        });
    });
});
