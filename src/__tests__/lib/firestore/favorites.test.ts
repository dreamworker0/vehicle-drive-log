/**
 * firestore/favorites 도메인 함수 단위 테스트
 * 즐겨찾기 조회(사용자 스코프)·추가·삭제 동작을 고정한다.
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
    collection: vi.fn((_db: unknown, ...path: string[]) => makeRef(`col:${path.join('/')}`)),
    doc: vi.fn((_db: unknown, ...path: string[]) => makeRef(`doc:${path.join('/')}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
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
    getFavorites, createFavorite, deleteFavorite,
    getFavoritePurposes, createFavoritePurpose, deleteFavoritePurpose,
} from '../../../lib/firestore/favorites';

// {id, ...data} 병합 반환 함수용 스냅샷 스텁 (doc.id 포함)
const docsSnapWithId = (rows: Array<{ id: string; [k: string]: unknown }>) => ({
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});

describe('firestore/favorites', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getFavorites', () => {
        it('userId로 필터링하고 최신순으로 조회해 id가 병합된 목록을 반환한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
                { id: 'f1', destination: '복지관' },
                { id: 'f2', destination: '보건소' },
            ]) as never);

            const result = await getFavorites('u1');

            expect(fs.where).toHaveBeenCalledWith('userId', '==', 'u1'); // 사용자 스코프
            expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
            expect(result).toEqual([
                { id: 'f1', destination: '복지관' },
                { id: 'f2', destination: '보건소' },
            ]);
        });

        // destination을 기록하지 않던 시절의 문서(관리 화면·예약 폼·바로 운행 경로)를
        // 읽기 입구에서 보정한다 — 이 값이 비면 폼에 undefined가 들어가 화면이 죽었다.
        it('destination 없이 저장된 옛 문서는 주소로, 주소도 없으면 별칭으로 채워 준다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
                { id: 'f1', name: '시청', address: '서울시 중구 세종대로 110' },
                { id: 'f2', name: '김OO 어르신 댁', address: '' },
                { id: 'f3', name: '보건소' },
            ]) as never);

            const result = await getFavorites('u1');

            expect(result[0].destination).toBe('서울시 중구 세종대로 110');
            expect(result[1].destination).toBe('김OO 어르신 댁');
            expect(result[2].destination).toBe('보건소');
        });
    });

    describe('createFavorite', () => {
        /** 마지막 addDoc 호출의 페이로드 */
        const lastPayload = () => {
            const calls = vi.mocked(fs.addDoc).mock.calls;
            return calls[calls.length - 1][1] as Record<string, unknown>;
        };

        it('serverTimestamp를 포함해 addDoc를 호출하고 docRef를 반환한다', async () => {
            const docRef = { id: 'f-new' };
            vi.mocked(fs.addDoc).mockResolvedValue(docRef as never);

            const result = await createFavorite({ userId: 'u1', name: '시청', address: '서울시 중구 세종대로 110' });

            expect(result).toBe(docRef);
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    userId: 'u1',
                    name: '시청',
                    address: '서울시 중구 세종대로 110',
                    destination: '서울시 중구 세종대로 110',
                    createdAt: '__serverTimestamp__',
                }),
            );
        });

        // 쓰기 경로가 네 곳이라 저장 모양이 갈라져 있었다 — 정규화를 여기 한 곳에 모은다.
        it('주소를 안 적으면 별칭이 목적지가 되고 빈 address 필드는 저장하지 않는다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'f-new' } as never);

            await createFavorite({ userId: 'u1', name: '  김OO 어르신 댁  ', address: '   ' });

            const payload = lastPayload();
            expect(payload.name).toBe('김OO 어르신 댁');
            expect(payload.destination).toBe('김OO 어르신 댁');
            expect(payload).not.toHaveProperty('address');
        });

        it('destination을 직접 넘기면 그 값을 쓴다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'f-new' } as never);

            await createFavorite({ userId: 'u1', name: '별칭', destination: '보건소' });

            expect(lastPayload().destination).toBe('보건소');
        });

        // Firestore는 undefined 값을 거부한다 — 소속 없는 계정(organizationId=null)에서
        // 즐겨찾기 저장이 통째로 실패하지 않게 키를 아예 빼고 보낸다.
        it('organizationId가 없거나 null이면 필드를 넣지 않는다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'f-new' } as never);

            await createFavorite({ userId: 'u1', name: '시청', organizationId: null });

            expect(lastPayload()).not.toHaveProperty('organizationId');
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.addDoc).mockRejectedValue(new Error('addDoc 실패') as never);

            await expect(createFavorite({ userId: 'u1', name: 'x' })).rejects.toThrow('addDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('deleteFavorite', () => {
        it('해당 즐겨찾기 문서를 삭제한다', async () => {
            vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);

            await deleteFavorite('f1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'favorites', 'f1');
            expect(fs.deleteDoc).toHaveBeenCalled();
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.deleteDoc).mockRejectedValue(new Error('deleteDoc 실패') as never);

            await expect(deleteFavorite('f1')).rejects.toThrow('deleteDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });
});

describe('firestore/favorites — 자주 쓰는 목적', () => {
    // 조회는 모듈 캐시로 묶이므로 테스트마다 다른 uid를 써서 서로 섞이지 않게 한다
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const ts = (ms: number) => ({ toMillis: () => ms });

    it('본인 uid로만 조회하고, 등록한 순서대로 돌려준다 (빈 문구는 뺀다)', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
            { id: 'p2', userId: 'u-order', text: '병원 동행', createdAt: ts(2000) },
            { id: 'p0', userId: 'u-order', text: '  ', createdAt: ts(500) },
            { id: 'p1', userId: 'u-order', text: '가정방문', createdAt: ts(1000) },
            // 서버 시각이 아직 없는 문서는 맨 뒤
            { id: 'p3', userId: 'u-order', text: '물품 구매' },
        ]) as never);

        const list = await getFavoritePurposes('u-order');

        expect(fs.where).toHaveBeenCalledWith('userId', '==', 'u-order');
        // 복합 인덱스가 필요 없도록 서버 정렬을 걸지 않는다
        expect(fs.orderBy).not.toHaveBeenCalled();
        expect(list.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('같은 사람의 두 번째 조회는 캐시에서 받고, 추가하면 다시 읽는다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
            { id: 'p1', userId: 'u-cache', text: '가정방문', createdAt: ts(1) },
        ]) as never);
        vi.mocked(fs.addDoc).mockResolvedValue({ id: 'new' } as never);

        await getFavoritePurposes('u-cache');
        await getFavoritePurposes('u-cache');
        expect(fs.getDocs).toHaveBeenCalledTimes(1);

        await createFavoritePurpose({ userId: 'u-cache', text: '병원 동행' });
        await getFavoritePurposes('u-cache');
        expect(fs.getDocs).toHaveBeenCalledTimes(2);
    });

    it('추가할 때 앞뒤 공백을 지우고 50자로 자르며, 소속이 없으면 organizationId를 넣지 않는다', async () => {
        vi.mocked(fs.addDoc).mockResolvedValue({ id: 'p9' } as never);

        const id = await createFavoritePurpose({ userId: 'u1', text: '  ' + '가'.repeat(60) + '  ', organizationId: null });

        expect(id).toBe('p9');
        const payload = vi.mocked(fs.addDoc).mock.calls[0][1] as Record<string, unknown>;
        expect(payload).toEqual({ userId: 'u1', text: '가'.repeat(50), createdAt: '__serverTimestamp__' });
    });

    it('소속 기관이 있으면 함께 남긴다 — 기관 해지 때 일괄 삭제하기 위해', async () => {
        vi.mocked(fs.addDoc).mockResolvedValue({ id: 'p10' } as never);
        await createFavoritePurpose({ userId: 'u1', text: '가정방문', organizationId: 'org-A' });
        const payload = vi.mocked(fs.addDoc).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.organizationId).toBe('org-A');
    });

    it('삭제 실패는 Sentry에 남기고 다시 던진다', async () => {
        vi.mocked(fs.deleteDoc).mockRejectedValue(new Error('permission-denied'));
        await expect(deleteFavoritePurpose('p1', 'u1')).rejects.toThrow('permission-denied');
        expect(captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: 'deleteFavoritePurpose' }));
    });
});
