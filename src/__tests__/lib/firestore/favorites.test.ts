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
import { getFavorites, createFavorite, deleteFavorite } from '../../../lib/firestore/favorites';

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
    });

    describe('createFavorite', () => {
        it('serverTimestamp를 포함해 addDoc를 호출하고 docRef를 반환한다', async () => {
            const docRef = { id: 'f-new' };
            vi.mocked(fs.addDoc).mockResolvedValue(docRef as never);

            const result = await createFavorite({ destination: '시청', userId: 'u1' });

            expect(result).toBe(docRef);
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    destination: '시청',
                    userId: 'u1',
                    createdAt: '__serverTimestamp__',
                }),
            );
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.addDoc).mockRejectedValue(new Error('addDoc 실패') as never);

            await expect(createFavorite({ destination: 'x' })).rejects.toThrow('addDoc 실패');
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
