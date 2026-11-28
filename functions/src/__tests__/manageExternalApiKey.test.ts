/**
 * manageExternalApiKey.test.ts — 외부 연동(API) 키 상태 조회·발급·폐기 콜러블
 *
 * 고정하는 계약 (2026-11-28 도입):
 *   - 기관 관리자(또는 superAdmin)만. 기관은 요청 본문이 아니라 클레임 orgId로 정한다
 *   - 발급은 기관이 승인 상태이고 [외부 연동(API)]을 켰을 때만
 *   - 발급하면 기존 키를 지우고 새 키 하나만 남긴다(기관당 하나)
 *   - 저장되는 것은 해시(문서 ID)와 끝 4자리뿐 — 원래 키는 응답에서 한 번만 나간다
 *   - 폐기는 토글이 꺼져 있어도 된다
 *   - 발급(create)·교체(update)·폐기(delete)는 키 변경과 같은 배치로 접속기록에 남는다.
 *     행위자는 호출자 uid(auth), 키 값·해시·끝 4자리는 기록에 없다
 */
class MockTimestamp {
    constructor(private readonly ms: number) {}
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
}

const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/rateLimit', () => ({ checkRateLimitByUid: mockCheckRateLimit }));
jest.mock('../utils/constants', () => ({
    getRateLimits: jest.fn().mockResolvedValue({ max: 30, windowSec: 3600 }),
}));
jest.mock('../core/sentry', () => ({
    captureError: jest.fn(),
    flushSentry: jest.fn().mockResolvedValue(undefined),
}));

const mockKeysGet = jest.fn();
const mockOrgGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCreate = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockWhere = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'externalApiKeys') {
                return {
                    where: (...args: unknown[]) => { mockWhere(...args); return { get: mockKeysGet }; },
                    doc: (id: string) => ({ id, path: `externalApiKeys/${id}` }),
                };
            }
            if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) };
            if (name === 'auditLogs') return { doc: (id: string) => ({ id, path: `auditLogs/${id}` }) };
            throw new Error(`예상하지 못한 컬렉션: ${name}`);
        },
        batch: () => ({ delete: mockBatchDelete, create: mockBatchCreate, set: mockBatchSet, commit: mockBatchCommit }),
    }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
    Timestamp: Object.assign(MockTimestamp, { fromMillis: (ms: number) => new MockTimestamp(ms) }),
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

import { manageExternalApiKey, type ManageExternalApiKeyResponse } from '../handlers/callable/manageExternalApiKey';
import { hashApiKey, isWellFormedApiKey } from '../services/externalApi/apiKeys';

const handler = manageExternalApiKey as unknown as (req: Record<string, unknown>) => Promise<ManageExternalApiKeyResponse>;

const admin = { uid: 'admin1', token: { role: 'admin', orgId: 'org1' } };
const enabledOrg = { exists: true, data: () => ({ status: 'approved', externalApiEnabled: true }) };
const oldKeyDoc = {
    ref: { path: 'externalApiKeys/oldhash' },
    data: () => ({ organizationId: 'org1', hint: 'AbCd', createdAt: new MockTimestamp(Date.UTC(2026, 10, 1)), lastUsedAt: null }),
};

describe('manageExternalApiKey — 외부 연동 키 관리', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockKeysGet.mockResolvedValue({ docs: [] });
        mockOrgGet.mockResolvedValue(enabledOrg);
    });

    it('인증이 없으면 unauthenticated', async () => {
        await expect(handler({ auth: null, data: { action: 'status' } })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('action이 틀리면 invalid-argument', async () => {
        await expect(handler({ auth: admin, data: { action: 'delete-all' } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ auth: admin, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('직원은 permission-denied', async () => {
        await expect(handler({ auth: { uid: 'e1', token: { role: 'employee', orgId: 'org1' } }, data: { action: 'status' } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockKeysGet).not.toHaveBeenCalled();
    });

    it('기관은 클레임 orgId로 정한다 — 본문에 다른 기관을 넣어도 무시', async () => {
        await handler({ auth: admin, data: { action: 'status', organizationId: 'org2' } });
        expect(mockWhere).toHaveBeenCalledWith('organizationId', '==', 'org1');
    });

    it('status — 키가 없으면 hasKey false', async () => {
        const out = await handler({ auth: admin, data: { action: 'status' } });
        expect(out).toEqual({ status: { hasKey: false } });
    });

    it('status — 키가 있으면 끝 4자리와 시각만 (원래 키는 없다)', async () => {
        mockKeysGet.mockResolvedValueOnce({ docs: [oldKeyDoc] });
        const out = await handler({ auth: admin, data: { action: 'status' } });
        expect(out.apiKey).toBeUndefined();
        expect(out.status).toEqual({ hasKey: true, hint: 'AbCd', createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null });
    });

    it('issue — 토글이 꺼진 기관은 failed-precondition', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        await expect(handler({ auth: admin, data: { action: 'issue' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('issue — 승인 전 기관은 failed-precondition', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending', externalApiEnabled: true }) });
        await expect(handler({ auth: admin, data: { action: 'issue' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('issue — 기존 키를 지우고 해시를 문서 ID로 새 키 하나를 만든다', async () => {
        mockKeysGet.mockResolvedValueOnce({ docs: [oldKeyDoc] });
        const out = await handler({ auth: admin, data: { action: 'issue' } });

        expect(isWellFormedApiKey(out.apiKey)).toBe(true);
        expect(mockBatchDelete).toHaveBeenCalledWith(oldKeyDoc.ref);

        const [ref, doc] = mockBatchCreate.mock.calls[0];
        expect(ref.id).toBe(hashApiKey(out.apiKey!));
        expect(doc).toEqual({
            organizationId: 'org1',
            hint: out.apiKey!.slice(-4),
            createdByUid: 'admin1',
            createdAt: 'SERVER_TS',
            lastUsedAt: null,
        });
        // 원래 키는 저장 문서 어디에도 없다
        expect(JSON.stringify(doc)).not.toContain(out.apiKey);
        expect(out.status).toMatchObject({ hasKey: true, hint: out.apiKey!.slice(-4), lastUsedAt: null });
    });

    /** 배치에 실린 접속기록 1건 */
    const auditWrite = () => {
        const calls = mockBatchSet.mock.calls.filter(([ref]) => String(ref.path).startsWith('auditLogs/'));
        expect(calls).toHaveLength(1);
        return calls[0] as [{ id: string }, Record<string, unknown>];
    };

    it('issue — 첫 발급은 "생성"으로, 키 변경과 같은 배치에 기록한다', async () => {
        const out = await handler({ auth: admin, data: { action: 'issue' } });

        const [ref, entry] = auditWrite();
        expect(ref.id).toMatch(/^externalApiKey_org1_/);
        expect(entry).toMatchObject({
            organizationId: 'org1',
            action: 'create',
            targetType: 'externalApiKey',
            targetId: 'org1',
            actorUid: 'admin1',
            actorSource: 'auth',
            subjectUids: [],
            at: 'SERVER_TS',
        });
        expect(entry).not.toHaveProperty('changedFields');
        // 키 값·해시·끝 4자리는 기록하지 않는다
        const text = JSON.stringify(entry);
        expect(text).not.toContain(out.apiKey);
        expect(text).not.toContain(hashApiKey(out.apiKey!));
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('issue — 기존 키가 있으면 "수정(키 교체)"으로 기록한다', async () => {
        mockKeysGet.mockResolvedValueOnce({ docs: [oldKeyDoc] });
        await handler({ auth: admin, data: { action: 'issue' } });

        const [, entry] = auditWrite();
        expect(entry).toMatchObject({ action: 'update', targetType: 'externalApiKey', changedFields: ['apiKey'] });
    });

    it('issue — 거절되면 기록도 남지 않는다', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        await expect(handler({ auth: admin, data: { action: 'issue' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockBatchSet).not.toHaveBeenCalled();
    });

    it('revoke — 폐기는 "삭제"로, 폐기한 사람과 함께 기록한다', async () => {
        mockKeysGet.mockResolvedValueOnce({ docs: [oldKeyDoc] });
        await handler({ auth: admin, data: { action: 'revoke' } });

        const [, entry] = auditWrite();
        expect(entry).toMatchObject({ action: 'delete', targetType: 'externalApiKey', actorUid: 'admin1', actorSource: 'auth' });
    });

    it('revoke — 지울 키가 없으면 쓰지도 기록하지도 않는다', async () => {
        const out = await handler({ auth: admin, data: { action: 'revoke' } });
        expect(out).toEqual({ status: { hasKey: false } });
        expect(mockBatchCommit).not.toHaveBeenCalled();
        expect(mockBatchSet).not.toHaveBeenCalled();
    });

    it('status — 조회는 기록하지 않는다', async () => {
        await handler({ auth: admin, data: { action: 'status' } });
        expect(mockBatchSet).not.toHaveBeenCalled();
    });

    it('revoke — 토글이 꺼져 있어도 기관의 키를 모두 지운다', async () => {
        mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ status: 'approved' }) });
        mockKeysGet.mockResolvedValueOnce({ docs: [oldKeyDoc] });
        const out = await handler({ auth: admin, data: { action: 'revoke' } });
        expect(mockBatchDelete).toHaveBeenCalledWith(oldKeyDoc.ref);
        expect(mockBatchCommit).toHaveBeenCalled();
        expect(out).toEqual({ status: { hasKey: false } });
    });
});
