/**
 * cleanupDuplicateLogs.test.ts
 * - 운행일지 중복 정리 onCall 함수 단위 테스트
 * - 핵심 회귀 대상: 교차 테넌트 차단(호출자 orgId ↔ 요청 organizationId 대조)
 * - Firebase Admin Firestore는 mock 처리
 */

const mockQueryGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({ delete: mockBatchDelete, commit: mockBatchCommit }));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            where: jest.fn(() => ({
                orderBy: jest.fn(() => ({ get: mockQueryGet })),
            })),
            doc: jest.fn((id: string) => ({ _id: id })),
        })),
        batch: mockBatch,
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

// timestamp가 null이면 호출되지 않지만, 방어적으로 고정값 반환
jest.mock('../utils/kstDate', () => ({
    getKSTDateString: () => '2026-07-01',
}));

import { cleanupDuplicateLogs } from "../handlers/callable/cleanupDuplicateLogs";

const handler = cleanupDuplicateLogs as unknown as (req: Record<string, unknown>) => Promise<{
    success: boolean;
    totalLogs: number;
    duplicateGroups: number;
    deleteCount: number;
    dryRun: boolean;
}>;

/** 스냅샷 목: 각 문서는 forEach 콜백에 { id, data() } 형태로 전달된다 */
function makeSnap(docs: Array<Record<string, unknown> & { id: string }>) {
    return {
        size: docs.length,
        forEach: (cb: (doc: { id: string; data: () => unknown }) => void) =>
            docs.forEach((d) => cb({ id: d.id, data: () => d })),
    };
}

// 동일 key(dateStr|vehicleId|driverUid|startKm|endKm)를 갖는 중복 문서 2건
const DUP_DOCS = [
    { id: 'log-keep', timestamp: null, vehicleId: 'v1', driverUid: 'd1', startKm: 100, endKm: 200, createdAt: 1 },
    { id: 'log-dup', timestamp: null, vehicleId: 'v1', driverUid: 'd1', startKm: 100, endKm: 200, createdAt: 2 },
];

describe('cleanupDuplicateLogs — 운행일지 중복 정리', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBatchCommit.mockResolvedValue(undefined);
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: { organizationId: 'org1' } };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('organizationId가 없으면 invalid-argument 에러를 던진다', async () => {
        const req = { auth: { uid: 'u1', token: { role: 'admin', orgId: 'org1' } }, data: {} };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('관리자가 아니면(employee) permission-denied 에러를 던진다', async () => {
        const req = {
            auth: { uid: 'u1', token: { role: 'employee', orgId: 'org1' } },
            data: { organizationId: 'org1' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('[교차 테넌트 차단] 타 기관 admin이 호출하면 permission-denied 에러를 던지고 쿼리를 수행하지 않는다', async () => {
        const req = {
            auth: { uid: 'u1', token: { role: 'admin', orgId: 'org1' } },
            data: { organizationId: 'org2', dryRun: false },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
        // 권한 차단이 DB 접근보다 먼저 이뤄져야 한다
        expect(mockQueryGet).not.toHaveBeenCalled();
        expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('본인 기관 admin은 정상 처리하며, dryRun 기본값(true)에서는 삭제하지 않는다', async () => {
        mockQueryGet.mockResolvedValueOnce(makeSnap(DUP_DOCS));
        const req = {
            auth: { uid: 'u1', token: { role: 'admin', orgId: 'org1' } },
            data: { organizationId: 'org1' }, // dryRun 미지정 → 기본 true
        };
        const result = await handler(req);

        expect(result).toMatchObject({
            success: true,
            totalLogs: 2,
            duplicateGroups: 1,
            deleteCount: 1,
            dryRun: true,
        });
        // dryRun이므로 실제 삭제는 일어나지 않음
        expect(mockBatchCommit).not.toHaveBeenCalled();
        expect(mockBatchDelete).not.toHaveBeenCalled();
    });

    it('dryRun:false면 중복분을 batch로 실제 삭제한다', async () => {
        mockQueryGet.mockResolvedValueOnce(makeSnap(DUP_DOCS));
        const req = {
            auth: { uid: 'u1', token: { role: 'admin', orgId: 'org1' } },
            data: { organizationId: 'org1', dryRun: false },
        };
        const result = await handler(req);

        expect(result).toMatchObject({ success: true, deleteCount: 1, dryRun: false });
        // 첫 문서는 보존(log-keep), 중복분(log-dup)만 삭제
        expect(mockBatchDelete).toHaveBeenCalledTimes(1);
        expect(mockBatchDelete).toHaveBeenCalledWith({ _id: 'log-dup' });
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('superAdmin은 타 기관 데이터도 정리할 수 있다', async () => {
        mockQueryGet.mockResolvedValueOnce(makeSnap(DUP_DOCS));
        const req = {
            auth: { uid: 'sa', token: { role: 'superAdmin', orgId: 'org1' } },
            data: { organizationId: 'org2', dryRun: false },
        };
        const result = await handler(req);

        expect(result).toMatchObject({ success: true, deleteCount: 1 });
        expect(mockBatchDelete).toHaveBeenCalledWith({ _id: 'log-dup' });
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });
});
