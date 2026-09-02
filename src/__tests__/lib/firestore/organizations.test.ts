/**
 * firestore/organizations 도메인 함수 단위 테스트
 *
 * 이 파일은 organizationId 경계가 사는 자리인데 커버리지가 26%였다 — `src/lib/firestore/**` 글롭 평균(57%)이
 * 통과하는 동안 잘 덮인 형제(favorites·auditLogs)가 이 파일의 공백을 가려 주고 있었다(2026-09-02 품질 점검).
 * 그래서 이 파일에는 vitest.config.js에 **파일 단위 하한**을 따로 건다.
 *
 * 고정하는 계약:
 *   - 초대 코드 재발급은 **서버 콜러블**로만 한다(클라이언트가 값을 고를 수 없다)
 *   - 상태별 목록 조회는 status 필터 + 정렬 + 상한(ORG_LIST_LIMIT)을 갖는다
 *   - 승인·삭제는 기관 문서와 소속 사용자 문서를 **한 배치**로 커밋한다(부분 실패 방지)
 *   - 모든 실패는 captureError로 보고한 뒤 다시 던진다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeRef = (label: string) => {
    const ref: { label: string; withConverter: (...a: unknown[]) => unknown } = {
        label,
        withConverter: () => ref,
    };
    return ref;
};

const mockBatch = {
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(),
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, path: string) => makeRef(`col:${path}`)),
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(`doc:${path}/${id ?? ''}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    getCountFromServer: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => mockBatch),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn(() => mockCallable),
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, firebaseFunctions: { __tag: 'functions' } }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { captureError } from '../../../lib/sentry';
import {
    findOrganizationByInviteCode,
    regenerateInviteCode,
    createOrganization,
    getOrganization,
    updateOrganization,
    deleteOrganization,
    permanentDeleteOrganization,
    restoreOrganization,
    getPendingOrganizationsCount,
    getApprovedOrganizationsCount,
    getPendingOrganizations,
    getRejectedOrganizations,
    getDeletedOrganizations,
    getApprovedOrganizations,
    approveOrganization,
    approveOrganizationWithAdmins,
    rejectOrganization,
} from '../../../lib/firestore/organizations';

type Constraint = { _type: string; field?: string; op?: string; value?: unknown; n?: number };
const constraintsOf = (call: unknown[]) => (call[0] as { constraints: Constraint[] }).constraints;

const orgDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => ({ id, ...data }) });

describe('firestore/organizations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBatch.commit.mockResolvedValue(undefined);
    });

    // ── 초대 코드 ──
    describe('findOrganizationByInviteCode', () => {
        it('승인된 기관 중 코드가 일치하는 1건만 조회한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue({
                empty: false, docs: [orgDoc('org-A', { name: '기관A', inviteCode: 'ABCDEF' })],
            } as never);

            const result = await findOrganizationByInviteCode('ABCDEF');

            expect(result).toMatchObject({ id: 'org-A', name: '기관A' });
            const constraints = constraintsOf(vi.mocked(fs.getDocs).mock.calls[0]);
            expect(constraints).toEqual(expect.arrayContaining([
                expect.objectContaining({ _type: 'where', field: 'inviteCode', op: '==', value: 'ABCDEF' }),
                expect.objectContaining({ _type: 'where', field: 'status', op: '==', value: 'approved' }),
                expect.objectContaining({ _type: 'limit', n: 1 }),
            ]));
        });

        it('일치하는 기관이 없으면 null', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue({ empty: true, docs: [] } as never);
            expect(await findOrganizationByInviteCode('NOPE00')).toBeNull();
        });

        it('조회 실패는 보고 후 다시 던진다', async () => {
            vi.mocked(fs.getDocs).mockRejectedValue(new Error('network'));
            await expect(findOrganizationByInviteCode('ABCDEF')).rejects.toThrow('network');
            expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: 'findOrganizationByInviteCode' }));
        });
    });

    describe('regenerateInviteCode — 서버 콜러블로만 발급한다', () => {
        it('regenerateInviteCode 콜러블을 공용 functions 인스턴스로 부르고 서버가 준 코드를 돌려준다', async () => {
            mockCallable.mockResolvedValue({ data: { inviteCode: 'SRV123' } });

            const code = await regenerateInviteCode('org-A');

            expect(code).toBe('SRV123');
            expect(httpsCallable).toHaveBeenCalledWith({ __tag: 'functions' }, 'regenerateInviteCode');
            expect(mockCallable).toHaveBeenCalledWith({ organizationId: 'org-A' });
            // 클라이언트가 문서를 직접 쓰지 않는다 — Rules가 기관관리자의 inviteCode 쓰기를 막는다
            expect(fs.updateDoc).not.toHaveBeenCalled();
        });

        it('콜러블 실패는 보고 후 다시 던진다 (비멱등 호출이라 재시도하지 않는다)', async () => {
            mockCallable.mockRejectedValue(new Error('permission-denied'));
            await expect(regenerateInviteCode('org-A')).rejects.toThrow('permission-denied');
            expect(mockCallable).toHaveBeenCalledTimes(1);
            expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: 'regenerateInviteCode', orgId: 'org-A' }));
        });
    });

    // ── CRUD ──
    describe('createOrganization', () => {
        it('사업자번호 중간이 82(비영리)면 approved + 초대코드 + approvedAt을 함께 만든다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'new-org' } as never);

            const id = await createOrganization({ name: '복지관', uniqueNumber: '123-82-45678' });

            expect(id).toBe('new-org');
            const payload = vi.mocked(fs.addDoc).mock.calls[0][1] as Record<string, unknown>;
            expect(payload.status).toBe('approved');
            expect(payload.approvedAt).toBe('__serverTimestamp__');
            expect(payload.createdAt).toBe('__serverTimestamp__');
            expect(payload.inviteCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
        });

        it('그 외 사업자번호는 pending으로 만들고 초대코드를 부여하지 않는다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'new-org' } as never);

            await createOrganization({ name: '주식회사', uniqueNumber: '123-81-45678' });

            const payload = vi.mocked(fs.addDoc).mock.calls[0][1] as Record<string, unknown>;
            expect(payload.status).toBe('pending');
            expect(payload).not.toHaveProperty('inviteCode');
            expect(payload).not.toHaveProperty('approvedAt');
        });

        it('사업자번호가 없으면 pending', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'new-org' } as never);
            await createOrganization({ name: '번호없음' });
            const payload = vi.mocked(fs.addDoc).mock.calls[0][1] as Record<string, unknown>;
            expect(payload.status).toBe('pending');
        });

        it('생성 실패는 보고 후 다시 던진다', async () => {
            vi.mocked(fs.addDoc).mockRejectedValue(new Error('denied'));
            await expect(createOrganization({ name: 'x' })).rejects.toThrow('denied');
            expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: 'createOrganization' }));
        });
    });

    describe('getOrganization / updateOrganization', () => {
        it('존재하면 변환된 데이터, 없으면 null', async () => {
            vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'org-A', name: '기관A' }) } as never);
            expect(await getOrganization('org-A')).toMatchObject({ name: '기관A' });

            vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => false } as never);
            expect(await getOrganization('none')).toBeNull();
        });

        it('updateOrganization은 전달한 부분 필드만 갱신한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined);
            await updateOrganization('org-A', { hipassEnabled: false, name: '새 이름' });
            const [ref, data] = vi.mocked(fs.updateDoc).mock.calls[0];
            expect((ref as unknown as { label: string }).label).toBe('doc:organizations/org-A');
            expect(data).toEqual({ hipassEnabled: false, name: '새 이름' });
        });

        it('조회·수정 실패는 각각 보고 후 다시 던진다', async () => {
            vi.mocked(fs.getDoc).mockRejectedValue(new Error('read fail'));
            await expect(getOrganization('org-A')).rejects.toThrow('read fail');
            vi.mocked(fs.updateDoc).mockRejectedValue(new Error('write fail'));
            await expect(updateOrganization('org-A', { name: 'x' })).rejects.toThrow('write fail');
            expect(captureError).toHaveBeenCalledTimes(2);
        });
    });

    // ── 삭제·복구 ──
    describe('deleteOrganization (soft) / permanentDeleteOrganization / restoreOrganization', () => {
        const members = { docs: [{ ref: 'userRef-1' }, { ref: 'userRef-2' }] };

        it('soft delete: 소속 사용자 문서 삭제 + 기관 status=deleted를 한 배치로 커밋한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(members as never);

            await deleteOrganization('org-A');

            const constraints = constraintsOf(vi.mocked(fs.getDocs).mock.calls[0]);
            expect(constraints).toEqual([expect.objectContaining({ field: 'organizationId', op: '==', value: 'org-A' })]);
            expect(mockBatch.delete).toHaveBeenCalledTimes(2);
            expect(mockBatch.delete).toHaveBeenCalledWith('userRef-1');
            expect(mockBatch.update).toHaveBeenCalledWith(
                expect.objectContaining({ label: 'doc:organizations/org-A' }),
                { status: 'deleted', deletedAt: '__serverTimestamp__', deletedBy: 'superAdmin' },
            );
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('영구 삭제: 사용자 문서와 기관 문서를 모두 지운다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(members as never);

            await permanentDeleteOrganization('org-A');

            expect(mockBatch.delete).toHaveBeenCalledTimes(3);
            expect(mockBatch.delete).toHaveBeenCalledWith(expect.objectContaining({ label: 'doc:organizations/org-A' }));
            expect(mockBatch.update).not.toHaveBeenCalled();
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('복구: status=approved, deletedAt=null', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined);
            await restoreOrganization('org-A');
            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.objectContaining({ label: 'doc:organizations/org-A' }),
                { status: 'approved', deletedAt: null },
            );
        });

        it('배치 커밋 실패는 보고 후 다시 던진다 (부분 반영 없음)', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(members as never);
            mockBatch.commit.mockRejectedValueOnce(new Error('commit fail'));
            await expect(deleteOrganization('org-A')).rejects.toThrow('commit fail');
            expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: 'deleteOrganization', orgId: 'org-A' }));

            mockBatch.commit.mockRejectedValueOnce(new Error('commit fail 2'));
            await expect(permanentDeleteOrganization('org-A')).rejects.toThrow('commit fail 2');

            vi.mocked(fs.updateDoc).mockRejectedValueOnce(new Error('restore fail'));
            await expect(restoreOrganization('org-A')).rejects.toThrow('restore fail');
            expect(captureError).toHaveBeenCalledTimes(3);
        });
    });

    // ── 상태별 조회 ──
    describe('상태별 카운트·목록', () => {
        it('카운트는 status 필터로 서버 집계를 쓴다', async () => {
            vi.mocked(fs.getCountFromServer).mockResolvedValueOnce({ data: () => ({ count: 3 }) } as never);
            expect(await getPendingOrganizationsCount()).toBe(3);
            expect(constraintsOf(vi.mocked(fs.getCountFromServer).mock.calls[0]))
                .toEqual([expect.objectContaining({ field: 'status', value: 'pending' })]);

            vi.mocked(fs.getCountFromServer).mockResolvedValueOnce({ data: () => ({ count: 42 }) } as never);
            expect(await getApprovedOrganizationsCount()).toBe(42);
            expect(constraintsOf(vi.mocked(fs.getCountFromServer).mock.calls[1]))
                .toEqual([expect.objectContaining({ field: 'status', value: 'approved' })]);
        });

        it.each([
            ['pending', getPendingOrganizations, 'createdAt'],
            ['rejected', getRejectedOrganizations, 'createdAt'],
            ['deleted', getDeletedOrganizations, 'deletedAt'],
            ['approved', getApprovedOrganizations, 'createdAt'],
        ] as const)('%s 목록: status 필터 + %s 내림차순 + 500건 상한', async (status, fn, orderField) => {
            vi.mocked(fs.getDocs).mockResolvedValue({ docs: [orgDoc('o1', { status }), orgDoc('o2', { status })] } as never);

            const result = await fn();

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ id: 'o1', status });
            const constraints = constraintsOf(vi.mocked(fs.getDocs).mock.calls[0]);
            expect(constraints).toEqual([
                expect.objectContaining({ _type: 'where', field: 'status', op: '==', value: status }),
                expect.objectContaining({ _type: 'orderBy', field: orderField, dir: 'desc' }),
                expect.objectContaining({ _type: 'limit', n: 500 }),
            ]);
        });

        it('목록·카운트 실패는 보고 후 다시 던진다', async () => {
            vi.mocked(fs.getDocs).mockRejectedValue(new Error('list fail'));
            await expect(getPendingOrganizations()).rejects.toThrow('list fail');
            vi.mocked(fs.getCountFromServer).mockRejectedValue(new Error('count fail'));
            await expect(getPendingOrganizationsCount()).rejects.toThrow('count fail');
            await expect(getApprovedOrganizationsCount()).rejects.toThrow('count fail');
            expect(captureError).toHaveBeenCalledTimes(3);
        });
    });

    // ── 승인·거절 ──
    describe('approveOrganization / approveOrganizationWithAdmins / rejectOrganization', () => {
        it('단독 승인: status·approvedAt·새 초대코드를 기록한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined);
            await approveOrganization('org-A');
            const [, data] = vi.mocked(fs.updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
            expect(data.status).toBe('approved');
            expect(data.approvedAt).toBe('__serverTimestamp__');
            expect(data.inviteCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
        });

        it('관리자 동반 승인: 기관 갱신 + 관리자별 organizationStatus를 한 배치로 커밋한다', async () => {
            await approveOrganizationWithAdmins('org-A', 'CODE01', ['admin-1', 'admin-2']);

            expect(mockBatch.update).toHaveBeenCalledWith(
                expect.objectContaining({ label: 'doc:organizations/org-A' }),
                { status: 'approved', approvedAt: '__serverTimestamp__', inviteCode: 'CODE01' },
            );
            expect(mockBatch.update).toHaveBeenCalledWith(
                expect.objectContaining({ label: 'doc:users/admin-1' }), { organizationStatus: 'approved' },
            );
            expect(mockBatch.update).toHaveBeenCalledWith(
                expect.objectContaining({ label: 'doc:users/admin-2' }), { organizationStatus: 'approved' },
            );
            expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        });

        it('거절: rejectedAt을 기록하고 사유가 있을 때만 rejectReason을 넣는다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined);

            await rejectOrganization('org-A');
            let data = vi.mocked(fs.updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
            expect(data.status).toBe('rejected');
            expect(data.rejectedAt).toBeInstanceOf(Date);
            expect(data).not.toHaveProperty('rejectReason');

            await rejectOrganization('org-A', '영리 기업');
            data = vi.mocked(fs.updateDoc).mock.calls[1][1] as unknown as Record<string, unknown>;
            expect(data.rejectReason).toBe('영리 기업');
        });

        it('승인·거절 실패는 보고 후 다시 던진다', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValue(new Error('approve fail'));
            await expect(approveOrganization('org-A')).rejects.toThrow('approve fail');
            await expect(rejectOrganization('org-A')).rejects.toThrow('approve fail');
            mockBatch.commit.mockRejectedValueOnce(new Error('batch fail'));
            await expect(approveOrganizationWithAdmins('org-A', 'CODE01', [])).rejects.toThrow('batch fail');
            expect(captureError).toHaveBeenCalledTimes(3);
        });
    });
});
