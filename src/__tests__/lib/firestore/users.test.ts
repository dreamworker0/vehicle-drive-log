/**
 * firestore/users 도메인 함수 단위 테스트
 * 사용자 CRUD·기관 소속 조회(org 격리)·Google OAuth 필드 관리 동작을 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── firebase/firestore 원시 함수 mock (vehicles.test.ts와 동일 하네스) ──
const makeRef = (label: string) => {
    const ref: { label: string; withConverter: (...a: unknown[]) => unknown } = {
        label,
        withConverter: () => ref,
    };
    return ref;
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, path: string) => makeRef(`col:${path}`)),
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(`doc:${path}/${id ?? ''}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    getCountFromServer: vi.fn(),
    addDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
    deleteField: vi.fn(() => '__deleteField__'),
    Timestamp: {
        now: () => ({ toMillis: () => 0, toDate: () => new Date(0) }),
        fromDate: (d: Date) => ({ toDate: () => d }),
    },
}));

// ── 앱 모듈 mock ──
vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: null }, firebaseFunctions: {} }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

// mock 선언 뒤에 import (호이스팅 주의)
import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/sentry';
import {
    getUser, createUser, updateUser, leaveOrganization,
    restoreUser, clearUserOrganization, recheckDeniedTarget,
    getOrganizationMembers, getOrganizationAdmins, getOrgMemberCounts,
} from '../../../lib/firestore/users';

// 스냅샷 스텁 헬퍼
const docsSnap = (rows: unknown[]) => ({ docs: rows.map(r => ({ data: () => r })) });
const getDocSnap = (data: unknown | null) => ({
    exists: () => data !== null,
    data: () => data,
    get: (field: string) => (data as Record<string, unknown> | null)?.[field],
});
// 쓰기·읽기 거부(Rules) 오류
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

describe('firestore/users', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getUser', () => {
        it('문서가 존재하면 데이터를 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ uid: 'u1', name: '홍길동' }) as never);

            const result = await getUser('u1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1');
            expect(result).toEqual({ uid: 'u1', name: '홍길동' });
        });

        it('문서가 없으면 null을 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap(null) as never);

            const result = await getUser('none');

            expect(result).toBeNull();
        });
    });

    describe('createUser', () => {
        it('theme 기본값 dark와 serverTimestamp를 포함해 setDoc를 호출한다', async () => {
            vi.mocked(fs.setDoc).mockResolvedValue(undefined as never);

            await createUser('u1', { name: '홍길동' });

            expect(fs.setDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    theme: 'dark',
                    name: '홍길동',
                    createdAt: '__serverTimestamp__',
                }),
            );
        });

        it('data에 theme가 오면 기본값을 덮어쓴다', async () => {
            vi.mocked(fs.setDoc).mockResolvedValue(undefined as never);

            await createUser('u1', { theme: 'light' });

            expect(fs.setDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ theme: 'light' }),
            );
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.setDoc).mockRejectedValue(new Error('setDoc 실패') as never);

            await expect(createUser('u1', {})).rejects.toThrow('setDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('updateUser', () => {
        it('전달한 데이터로 updateDoc를 호출한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await updateUser('u1', { name: '새이름' });

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1');
            expect(fs.updateDoc).toHaveBeenCalledWith(expect.anything(), { name: '새이름' });
        });

        it('대상 문서가 없으면(not-found) 보고 없이 에러만 재던진다', async () => {
            // 본인이 기관을 나가면 users 문서가 삭제되므로, 낡은 목록에서 오는 예상된 실패다.
            const err = Object.assign(new Error('No document to update'), { code: 'not-found' });
            vi.mocked(fs.updateDoc).mockRejectedValue(err as never);

            await expect(updateUser('u1', { name: '새이름' })).rejects.toThrow('No document to update');
            expect(captureError).not.toHaveBeenCalled();
        });

        it('대상이 같은 기관에 그대로 있는데 거부되면 예전처럼 captureError로 보고한다', async () => {
            const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
            vi.mocked(fs.updateDoc).mockRejectedValue(err as never);
            // 재확인 읽기는 성공한다 — 대상이 아직 기관에 있다는 뜻이라 진짜 권한 문제다
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ organizationId: 'org1' }) as never);

            await expect(updateUser('u1', { name: '새이름' })).rejects.toBe(err);
            expect(captureError).toHaveBeenCalledWith(err, expect.objectContaining({ context: 'updateUser' }));
        });

        it('본인이 기관을 나가 소속이 비워진 직원이면(permission-denied) not-found로 바꿔 던지고 보고하지 않는다', async () => {
            // 탈퇴(clearUserOrganization) 후에도 문서는 남는다 — 관리자의 쓰기는 isOrgAdmin(null)로,
            // 재확인 읽기는 "미소속 문서는 본인 외 열람 불가"로 둘 다 거부된다.
            const writeErr = denied();
            vi.mocked(fs.updateDoc).mockRejectedValue(writeErr as never);
            vi.mocked(fs.getDoc).mockRejectedValue(denied() as never);

            const thrown = await updateUser('u1', { role: 'admin' }).catch((e: unknown) => e);

            expect(thrown).toMatchObject({ code: 'not-found', cause: writeErr });
            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1');
            expect(captureError).not.toHaveBeenCalled();
        });
    });

    describe('leaveOrganization', () => {
        it('사용자 문서를 삭제한다 (슈퍼관리자의 멤버 제거 — Rules상 superAdmin 전용)', async () => {
            vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);

            await leaveOrganization('u1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1');
            expect(fs.deleteDoc).toHaveBeenCalled();
        });
    });

    describe('restoreUser', () => {
        it('status를 active로 되돌리고 disabledAt을 초기화한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await restoreUser('u1');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { status: 'active', disabledAt: null },
            );
        });

        it('대상 문서가 없으면(not-found) 보고 없이 에러만 재던진다', async () => {
            const err = Object.assign(new Error('No document to update'), { code: 'not-found' });
            vi.mocked(fs.updateDoc).mockRejectedValue(err as never);

            await expect(restoreUser('u1')).rejects.toThrow('No document to update');
            expect(captureError).not.toHaveBeenCalled();
        });

        it('소속이 비워진 직원이면(permission-denied) not-found로 바꿔 던지고 보고하지 않는다', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValue(denied() as never);
            vi.mocked(fs.getDoc).mockRejectedValue(denied() as never);

            await expect(restoreUser('u1')).rejects.toMatchObject({ code: 'not-found' });
            expect(captureError).not.toHaveBeenCalled();
        });
    });

    describe('recheckDeniedTarget', () => {
        it('permission-denied가 아니면 읽지 않고 원래 오류를 돌려준다', async () => {
            const err = Object.assign(new Error('offline'), { code: 'unavailable' });

            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toBe(err);
            expect(fs.getDoc).not.toHaveBeenCalled();
        });

        it('콜러블의 functions/permission-denied도 재확인한다', async () => {
            const err = Object.assign(new Error('다른 기관의 직원을 비활성화할 수 없습니다.'), { code: 'functions/permission-denied' });
            vi.mocked(fs.getDoc).mockRejectedValue(denied() as never);

            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toMatchObject({ code: 'not-found', cause: err });
        });

        it('읽혔는데 문서가 없거나 소속이 다르면 빠진 것으로 본다', async () => {
            const err = denied();
            vi.mocked(fs.getDoc).mockResolvedValueOnce(getDocSnap(null) as never);
            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toMatchObject({ code: 'not-found' });

            vi.mocked(fs.getDoc).mockResolvedValueOnce(getDocSnap({ organizationId: null }) as never);
            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toMatchObject({ code: 'not-found' });
        });

        it('같은 기관에 그대로 있으면 원래 오류를 돌려준다', async () => {
            const err = denied();
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ organizationId: 'org1' }) as never);

            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toBe(err);
        });

        it('재확인 읽기가 다른 이유로 실패하면 판단하지 않고 원래 오류를 돌려준다', async () => {
            const err = denied();
            vi.mocked(fs.getDoc).mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }) as never);

            expect(await recheckDeniedTarget(err, 'u1', 'org1')).toBe(err);
            expect(captureError).not.toHaveBeenCalled();
        });
    });

    describe('clearUserOrganization', () => {
        it('organizationId를 비우고 role을 employee로 초기화한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await clearUserOrganization('u1');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { organizationId: null, role: 'employee' },
            );
        });

        it('본인 기관 나가기는 문서를 지우지 않는다 — users 삭제는 Rules상 superAdmin 전용', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await clearUserOrganization('u1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1');
            expect(fs.deleteDoc).not.toHaveBeenCalled();
        });

        it('실패하면 보고하고 에러를 재던진다 (화면이 실패 토스트를 띄운다)', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValue(new Error('denied') as never);

            await expect(clearUserOrganization('u1')).rejects.toThrow('denied');
            expect(captureError).toHaveBeenCalledWith(expect.any(Error), { context: 'clearUserOrganization', uid: 'u1' });
        });
    });

    describe('getOrganizationMembers', () => {
        it('orgId로 필터링해 직원 목록을 반환한다', async () => {
            const rows = [{ uid: 'u1' }, { uid: 'u2' }];
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap(rows) as never);

            const result = await getOrganizationMembers('org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리 규칙
            expect(result).toHaveLength(2);
        });
    });

    describe('getOrganizationAdmins', () => {
        it('orgId와 admin role 두 조건으로 필터링한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([{ uid: 'a1', role: 'admin' }]) as never);

            const result = await getOrganizationAdmins('org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리 규칙
            expect(fs.where).toHaveBeenCalledWith('role', '==', 'admin');
            expect(result).toHaveLength(1);
        });
    });

    describe('getOrgMemberCounts', () => {
        it('orgIds가 없으면 빈 객체를 반환하고 서버 조회를 하지 않는다', async () => {
            expect(await getOrgMemberCounts()).toEqual({});
            expect(await getOrgMemberCounts([])).toEqual({});
            expect(fs.getCountFromServer).not.toHaveBeenCalled();
        });

        it('기관별로 getCountFromServer를 호출해 멤버 수 맵을 반환한다', async () => {
            vi.mocked(fs.getCountFromServer)
                .mockResolvedValueOnce({ data: () => ({ count: 3 }) } as never)
                .mockResolvedValueOnce({ data: () => ({ count: 7 }) } as never);

            const result = await getOrgMemberCounts(['org1', 'org2']);

            expect(fs.getCountFromServer).toHaveBeenCalledTimes(2);
            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1');
            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org2');
            expect(result).toEqual({ org1: 3, org2: 7 });
        });
    });

});
