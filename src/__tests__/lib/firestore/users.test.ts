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
    restoreUser, clearUserOrganization,
    getOrganizationMembers, getOrganizationAdmins, getOrgMemberCounts,
    saveUserGoogleOauth, getUserGoogleOauth, clearUserGoogleOauth,
} from '../../../lib/firestore/users';
import type { GoogleOauthData } from '../../../types/user';

// 스냅샷 스텁 헬퍼
const docsSnap = (rows: unknown[]) => ({ docs: rows.map(r => ({ data: () => r })) });
const getDocSnap = (data: unknown | null) => ({ exists: () => data !== null, data: () => data });

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
    });

    describe('leaveOrganization', () => {
        it('사용자 문서를 삭제한다', async () => {
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

    describe('Google OAuth 필드 관리', () => {
        const oauthData: GoogleOauthData = {
            refreshToken: 'rt-1',
        } as GoogleOauthData;

        it('saveUserGoogleOauth는 googleOauth 필드로 updateDoc를 호출한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await saveUserGoogleOauth('u1', oauthData);

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { googleOauth: oauthData },
            );
        });

        it('getUserGoogleOauth는 문서가 없으면 null을 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap(null) as never);

            expect(await getUserGoogleOauth('none')).toBeNull();
        });

        it('getUserGoogleOauth는 googleOauth 필드가 없으면 null, 있으면 그 값을 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ uid: 'u1' }) as never);
            expect(await getUserGoogleOauth('u1')).toBeNull();

            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ uid: 'u1', googleOauth: oauthData }) as never);
            expect(await getUserGoogleOauth('u1')).toEqual(oauthData);
        });

        it('clearUserGoogleOauth는 deleteField로 필드를 제거한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await clearUserGoogleOauth('u1');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { googleOauth: '__deleteField__' },
            );
        });

        it('clearUserGoogleOauth 실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValue(new Error('updateDoc 실패') as never);

            await expect(clearUserGoogleOauth('u1')).rejects.toThrow('updateDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });
});
