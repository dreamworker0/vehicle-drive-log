import { cleanupExpiredRateLimits } from "../utils/rateLimit";

// Firestore mock
const mockGet = jest.fn();
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

    describe('checkRateLimitByIp() — IP 기반 Rate Limit', () => {
        it('허용 범위 내 요청 → false 반환 (통과)', async () => {
            // 현재 count=2, max=5이므로 통과
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 2 }) }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            const exceeded = await checkRateLimitByIp('tmapProxy', '192.168.1.1', 5, 60);
            expect(exceeded).toBe(false);
        });

        it('한도 초과 → true 반환 (차단)', async () => {
            // 현재 count=5, max=5이므로 초과
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 5 }) }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            const exceeded = await checkRateLimitByIp('tmapProxy', '192.168.1.1', 5, 60);
            expect(exceeded).toBe(true);
        });

        it('첫 번째 요청 (문서 없음) → false 반환 (통과)', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            const exceeded = await checkRateLimitByIp('tmapProxy', '10.0.0.1', 10, 60);
            expect(exceeded).toBe(false);
        });

        it('IPv4 점(.)이 포함된 IP → 안전한 문자로 치환 후 동작', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            // 에러 없이 실행되면 통과
            await expect(
                checkRateLimitByIp('tmapProxy', '192.168.100.200', 5, 60)
            ).resolves.not.toThrow();
        });

        it('IPv6 콜론(:)이 포함된 IP → 안전한 문자로 치환 후 동작', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByIp('tmapProxy', '2001:db8::1', 5, 60)
            ).resolves.not.toThrow();
        });

        it('Firestore 에러 발생 시 → false 반환 (장애 시 기능 차단 방지)', async () => {
            mockRunTransaction.mockRejectedValueOnce(new Error('Firestore 연결 실패'));

            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            const exceeded = await checkRateLimitByIp('tmapProxy', '1.2.3.4', 5, 60);
            expect(exceeded).toBe(false);
        });
    });

    describe('checkRateLimitByUid() — UID 기반 Rate Limit', () => {
        it('허용 범위 내 → 정상 통과 (에러 없음)', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 3 }) }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByUid } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByUid('ocrDashboard', 'uid-abc', 10, 3600)
            ).resolves.not.toThrow();
        });

        it('한도 초과 → HttpsError("resource-exhausted") throw', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 10 }) }),
                    set: jest.fn(),
                })
            );

            const { checkRateLimitByUid } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByUid('ocrDashboard', 'uid-abc', 10, 3600)
            ).rejects.toThrow('요청이 너무 많습니다');
        });
    });
});
