/**
 * refreshDashboardStats.test.ts
 * - 대시보드 통계 수동 갱신 onCall 함수 단위 테스트
 * - 핵심 회귀 대상: 5분 쿨다운(연타·다중 superAdmin 동시 클릭 → 수만 read 풀스캔 중복 방지),
 *   시계 스큐·잘못된 값에서의 fail-open(재집계 허용)
 * - Firebase Admin Firestore·재집계 서비스는 mock 처리
 */

const mockUserGet = jest.fn();
const mockStatsGet = jest.fn();
const mockCompute = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ get: mockUserGet })),
        })),
        doc: jest.fn(() => ({ get: mockStatsGet })),
    }),
}));

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

jest.mock('../services/statistics/computeDashboardStats', () => ({
    computeAllDashboardStats: (...args: unknown[]) => mockCompute(...args),
}));

import { refreshDashboardStats } from '../handlers/callable/refreshDashboardStats';

const handler = refreshDashboardStats as unknown as (req: Record<string, unknown>) => Promise<{
    success: boolean;
    skipped: boolean;
    lastUpdatedAt?: string;
    retryAfterSec?: number;
}>;

const SUPER_ADMIN_REQ = { auth: { uid: 'sa1', token: {} }, data: {} };

/** 사용자 문서 스냅샷 목 */
const userSnap = (data: Record<string, unknown> | undefined) => ({ data: () => data });
/** 캐시 문서 스냅샷 목 — get('lastUpdatedAt') 형태로 읽는다 */
const statsSnap = (lastUpdatedAt: string | undefined) => ({
    get: (field: string) => (field === 'lastUpdatedAt' ? lastUpdatedAt : undefined),
});

describe('refreshDashboardStats — 대시보드 수동 갱신 쿨다운', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserGet.mockResolvedValue(userSnap({ role: 'superAdmin' }));
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        await expect(handler({ auth: null, data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockCompute).not.toHaveBeenCalled();
    });

    it('superAdmin이 아니면 permission-denied 에러를 던진다', async () => {
        mockUserGet.mockResolvedValue(userSnap({ role: 'admin' }));
        await expect(handler(SUPER_ADMIN_REQ)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCompute).not.toHaveBeenCalled();
    });

    it('캐시가 없으면(초기 시딩) 재집계를 수행한다', async () => {
        mockStatsGet.mockResolvedValue(statsSnap(undefined));

        const result = await handler(SUPER_ADMIN_REQ);

        expect(mockCompute).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, skipped: false });
    });

    it('쿨다운(5분) 내 재요청이면 재집계를 생략하고 남은 대기 시간을 반환한다', async () => {
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        mockStatsGet.mockResolvedValue(statsSnap(twoMinAgo));

        const result = await handler(SUPER_ADMIN_REQ);

        expect(mockCompute).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.lastUpdatedAt).toBe(twoMinAgo);
        // 5분 - 2분 경과 = 약 3분(±수 초) 남음
        expect(result.retryAfterSec).toBeGreaterThan(170);
        expect(result.retryAfterSec).toBeLessThanOrEqual(180);
    });

    it('쿨다운이 지났으면 재집계를 수행한다', async () => {
        const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        mockStatsGet.mockResolvedValue(statsSnap(sixMinAgo));

        const result = await handler(SUPER_ADMIN_REQ);

        expect(mockCompute).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, skipped: false });
    });

    it('lastUpdatedAt이 잘못된 값(NaN)이면 fail-open으로 재집계를 수행한다', async () => {
        mockStatsGet.mockResolvedValue(statsSnap('not-a-date'));

        const result = await handler(SUPER_ADMIN_REQ);

        expect(mockCompute).toHaveBeenCalledTimes(1);
        expect(result.skipped).toBe(false);
    });

    it('lastUpdatedAt이 미래 시각(시계 스큐)이면 fail-open으로 재집계를 수행한다', async () => {
        const future = new Date(Date.now() + 60 * 1000).toISOString();
        mockStatsGet.mockResolvedValue(statsSnap(future));

        const result = await handler(SUPER_ADMIN_REQ);

        expect(mockCompute).toHaveBeenCalledTimes(1);
        expect(result.skipped).toBe(false);
    });
});
