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

    describe('checkDailyOcrQuota() — OCR 일일 누적 한도 (사용자/조직)', () => {
        const USER_LIMIT = { max: 20, windowSec: 86400 };
        const ORG_LIMIT = { max: 50, windowSec: 86400 };

        const txWithCount = (count: number) => async (fn: any) =>
            fn({
                get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count }) }),
                set: jest.fn(),
            });

        it('사용자·조직 모두 한도 미만 → 통과 (카운터 2회 검사)', async () => {
            mockRunTransaction.mockImplementation(txWithCount(3) as any);

            const { checkDailyOcrQuota } = await import('../utils/rateLimit');
            await expect(
                checkDailyOcrQuota('uid-abc', 'org-1', USER_LIMIT, ORG_LIMIT)
            ).resolves.not.toThrow();
            expect(mockRunTransaction).toHaveBeenCalledTimes(2);
        });

        it('사용자 일일 한도 도달 → "일일 OCR 호출 한도" 에러', async () => {
            mockRunTransaction.mockImplementationOnce(txWithCount(20) as any);

            const { checkDailyOcrQuota } = await import('../utils/rateLimit');
            await expect(
                checkDailyOcrQuota('uid-abc', 'org-1', USER_LIMIT, ORG_LIMIT)
            ).rejects.toThrow('일일 OCR 호출 한도를 초과했습니다');
        });

        it('조직 일일 한도 도달(사용자는 통과) → "일일 OCR 호출 한도" 에러', async () => {
            mockRunTransaction
                .mockImplementationOnce(txWithCount(3) as any)   // 사용자 카운터: 통과
                .mockImplementationOnce(txWithCount(50) as any); // 조직 카운터: 초과

            const { checkDailyOcrQuota } = await import('../utils/rateLimit');
            await expect(
                checkDailyOcrQuota('uid-abc', 'org-1', USER_LIMIT, ORG_LIMIT)
            ).rejects.toThrow('일일 OCR 호출 한도를 초과했습니다');
        });

        it('orgId가 없으면 사용자 카운터만 검사한다', async () => {
            mockRunTransaction.mockImplementation(txWithCount(3) as any);

            const { checkDailyOcrQuota } = await import('../utils/rateLimit');
            await expect(
                checkDailyOcrQuota('uid-abc', undefined, USER_LIMIT, ORG_LIMIT)
            ).resolves.not.toThrow();
            expect(mockRunTransaction).toHaveBeenCalledTimes(1);
        });
    });
});
