/**
 * getOrgDocumentUrl.test.ts
 * - 기관 증빙서류(사업자등록증·고유번호증) 5분 서명 URL 발급
 * - 지키는 것: superAdmin만, 그 기관 폴더 안의 파일만(경로 조작 차단), 열람 사실은 감사 기록으로
 */

const mockOrgGet = jest.fn();
const mockExists = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockFile = jest.fn((_path: string) => ({ exists: mockExists, getSignedUrl: mockGetSignedUrl }));
const mockWriteAuditEntry = jest.fn().mockResolvedValue(undefined);
const mockLog = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: mockOrgGet })) })),
    }),
}));
jest.mock('firebase-admin/storage', () => ({
    getStorage: () => ({ bucket: () => ({ file: mockFile }) }),
}));
jest.mock('../services/audit/writeAuditEntry', () => ({
    writeAuditEntry: (...args: unknown[]) => mockWriteAuditEntry(...args),
}));
jest.mock('../utils/helpers', () => ({ log: (...args: unknown[]) => mockLog(...args) }));
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

import { getOrgDocumentUrl } from '../handlers/callable/getOrgDocumentUrl';

const handler = getOrgDocumentUrl as unknown as (req: Record<string, unknown>) => Promise<{ url: string }>;
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const call = (data: unknown, auth: unknown = superAdmin) => handler({ auth, data });
const orgDoc = (data: Record<string, unknown> | null) =>
    mockOrgGet.mockResolvedValueOnce({ exists: data !== null, data: () => data ?? undefined });

describe('getOrgDocumentUrl', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockExists.mockResolvedValue([true]);
        mockGetSignedUrl.mockResolvedValue(['https://signed.example/doc']);
        mockWriteAuditEntry.mockResolvedValue(undefined);
    });

    describe('권한·입력', () => {
        it('로그인하지 않으면 거부한다', async () => {
            await expect(call({ orgId: 'org1' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        });

        it.each(['admin', 'employee', undefined])('role=%s는 거부한다 — 증빙서류는 심사자만 연다', async (role) => {
            await expect(call({ orgId: 'org1' }, { uid: 'u1', token: { role } }))
                .rejects.toMatchObject({ code: 'permission-denied' });
            expect(mockOrgGet).not.toHaveBeenCalled();
        });

        it.each([undefined, '', 'org1/sub', '..', 123])('기관 ID %p는 거부한다', async (orgId) => {
            await expect(call({ orgId })).rejects.toMatchObject({ code: 'invalid-argument' });
        });

        it('기관이 없으면 not-found', async () => {
            orgDoc(null);
            await expect(call({ orgId: 'org1' })).rejects.toMatchObject({ code: 'not-found' });
        });

        it('증빙서류 경로가 없으면 not-found', async () => {
            orgDoc({ name: '복지관' });
            await expect(call({ orgId: 'org1' })).rejects.toMatchObject({ code: 'not-found' });
        });
    });

    describe('경로 — 그 기관 폴더 안의 파일만', () => {
        it.each([
            ['다른 기관 폴더', 'organizations/org2/doc.png'],
            ['상위 이동', 'organizations/org1/../org2/doc.png'],
            ['역슬래시', 'organizations/org1\\doc.png'],
            ['절대 경로', '/organizations/org1/doc.png'],
            ['기관 폴더 밖', 'feedbacks/u1/a.png'],
        ])('%s(%s)는 서명하지 않는다', async (_label, path) => {
            orgDoc({ uniqueNumberImagePath: path });
            await expect(call({ orgId: 'org1' })).rejects.toMatchObject({ code: 'failed-precondition' });
            expect(mockGetSignedUrl).not.toHaveBeenCalled();
        });

        it('저장된 경로로 5분짜리 읽기 URL을 발급한다', async () => {
            orgDoc({ uniqueNumberImagePath: 'organizations/org1/unique.png' });
            const before = Date.now();
            await expect(call({ orgId: 'org1' })).resolves.toEqual({ url: 'https://signed.example/doc' });

            expect(mockFile).toHaveBeenCalledWith('organizations/org1/unique.png');
            const { action, expires } = mockGetSignedUrl.mock.calls[0][0];
            expect(action).toBe('read');
            expect(expires - before).toBeGreaterThanOrEqual(5 * 60 * 1000);
            expect(expires - before).toBeLessThan(5 * 60 * 1000 + 5000);
        });

        it('레거시 토큰 URL에서 경로를 꺼낸다(쿼리 유무 모두)', async () => {
            orgDoc({ uniqueNumberImageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/organizations%2Forg1%2Fold.png?alt=media&token=t' });
            await call({ orgId: 'org1' });
            expect(mockFile).toHaveBeenLastCalledWith('organizations/org1/old.png');

            orgDoc({ uniqueNumberImageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/organizations%2Forg1%2Fbare.png' });
            await call({ orgId: 'org1' });
            expect(mockFile).toHaveBeenLastCalledWith('organizations/org1/bare.png');
        });

        it('레거시 URL이 다른 기관 파일을 가리키면 거부한다', async () => {
            orgDoc({ uniqueNumberImageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/organizations%2Forg2%2Fdoc.png?alt=media' });
            await expect(call({ orgId: 'org1' })).rejects.toMatchObject({ code: 'failed-precondition' });
        });

        it('파일이 지워졌으면 not-found', async () => {
            orgDoc({ uniqueNumberImagePath: 'organizations/org1/unique.png' });
            mockExists.mockResolvedValueOnce([false]);
            await expect(call({ orgId: 'org1' })).rejects.toMatchObject({ code: 'not-found' });
            expect(mockGetSignedUrl).not.toHaveBeenCalled();
        });
    });

    describe('열람 기록', () => {
        it('발급한 뒤 심사 대상 기관 기준으로 남긴다(정보주체 uid는 비운다)', async () => {
            orgDoc({ uniqueNumberImagePath: 'organizations/org1/unique.png' });
            await call({ orgId: 'org1' });

            expect(mockWriteAuditEntry).toHaveBeenCalledTimes(1);
            const entry = mockWriteAuditEntry.mock.calls[0][0];
            expect(entry).toMatchObject({
                organizationId: 'org1', action: 'read', targetType: 'orgDocument',
                targetId: 'org1', actorUid: 'sa1', subjectUids: [],
            });
            // 같은 분 안의 연속 조회는 한 문서로 합쳐진다
            expect(entry.docId).toMatch(/^orgdoc_sa1_org1_\d{8}T\d{4}$/);
            expect(mockGetSignedUrl.mock.invocationCallOrder[0]).toBeLessThan(mockWriteAuditEntry.mock.invocationCallOrder[0]);
        });

        it('검증에서 걸린 요청은 기록하지 않는다', async () => {
            orgDoc({ uniqueNumberImagePath: 'organizations/org2/doc.png' });
            await expect(call({ orgId: 'org1' })).rejects.toBeDefined();
            expect(mockWriteAuditEntry).not.toHaveBeenCalled();
        });

        it('기록이 실패해도 URL은 돌려주고 ERROR 로그를 남긴다', async () => {
            orgDoc({ uniqueNumberImagePath: 'organizations/org1/unique.png' });
            mockWriteAuditEntry.mockRejectedValueOnce(new Error('firestore down'));

            await expect(call({ orgId: 'org1' })).resolves.toEqual({ url: 'https://signed.example/doc' });
            expect(mockLog).toHaveBeenCalledWith('ERROR', 'getOrgDocumentUrl', expect.any(String), expect.objectContaining({ orgId: 'org1' }));
        });
    });
});
