/**
 * rateLimitFailMode.test — Rate Limit 확인 실패 시 failMode 계약 검증
 * (2026-07-10 코덱스 평가 대응 개선계획 작업 2)
 *
 * 계약:
 * - failMode 미지정(기본 "open"): Firestore 장애 시 요청 통과 (기존 동작 보존)
 * - failMode "closed": Firestore 장애 시 요청 거부 (고위험 경로의 비용 증폭 차단)
 * - checkDailyOcrQuota는 항상 closed 경로를 탄다
 */

const mockRunTransaction = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ doc: () => ({ id: 'test-doc' }) }),
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

describe('rateLimit failMode — 확인 실패 시 정책', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        // 모든 케이스에서 Firestore 트랜잭션이 실패하는 상황을 가정
        mockRunTransaction.mockRejectedValue(new Error('Firestore 연결 실패'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('checkRateLimitByUid()', () => {
        it('기본(open): Firestore 장애 → 통과 (기존 동작 보존)', async () => {
            const { checkRateLimitByUid } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByUid('someBusinessApi', 'uid-1', 10, 60)
            ).resolves.not.toThrow();
        });

        it('closed: Firestore 장애 → resource-exhausted 거부', async () => {
            const { checkRateLimitByUid } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByUid('askAI', 'uid-1', 10, 60, 'closed')
            ).rejects.toMatchObject({ code: 'resource-exhausted' });
        });

        it('closed: 정상 동작 시(장애 아님)에는 한도 내 요청을 통과시킨다', async () => {
            mockRunTransaction.mockImplementationOnce(async (fn: any) =>
                fn({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ count: 1 }) }),
                    set: jest.fn(),
                })
            );
            const { checkRateLimitByUid } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByUid('askAI', 'uid-1', 10, 60, 'closed')
            ).resolves.not.toThrow();
        });
    });

    describe('checkRateLimitByIp()', () => {
        it('기본(open): Firestore 장애 → false 반환 (통과)', async () => {
            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByIp('tmapProxy', '1.2.3.4', 10, 60)
            ).resolves.toBe(false);
        });

        it('closed: Firestore 장애 → true 반환 (초과로 간주해 거부)', async () => {
            const { checkRateLimitByIp } = await import('../utils/rateLimit');
            await expect(
                checkRateLimitByIp('submitOrgApplication', '1.2.3.4', 10, 60, 'closed')
            ).resolves.toBe(true);
        });
    });

    describe('checkDailyOcrQuota()', () => {
        it('Firestore 장애 → closed 경로로 거부 (비용 방어선 유지)', async () => {
            const { checkDailyOcrQuota } = await import('../utils/rateLimit');
            await expect(
                checkDailyOcrQuota('uid-1', 'org-1', { max: 20, windowSec: 86400 }, { max: 50, windowSec: 86400 })
            ).rejects.toMatchObject({ code: 'resource-exhausted' });
        });
    });
});
