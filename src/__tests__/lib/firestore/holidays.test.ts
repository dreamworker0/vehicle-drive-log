/**
 * firestore/holidays 도메인 함수 단위 테스트
 * 기관 커스텀 휴일 CRUD — 기관 격리는 서브컬렉션 경로(organizations/{orgId}/customHolidays)로
 * 이뤄지므로 경로 인자 단언으로 고정한다.
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
import { getCustomHolidays, addCustomHoliday, deleteCustomHoliday } from '../../../lib/firestore/holidays';

// {id, ...data} 병합 반환 함수용 스냅샷 스텁 (doc.id 포함)
const docsSnapWithId = (rows: Array<{ id: string; [k: string]: unknown }>) => ({
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});

describe('firestore/holidays', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCustomHolidays', () => {
        it('기관 서브컬렉션 경로로 날짜 오름차순 조회해 id가 병합된 목록을 반환한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
                { id: 'h1', date: '2026-08-15', name: '기관 창립일' },
            ]) as never);

            const result = await getCustomHolidays('org1');

            // 기관 격리: 컬렉션 경로에 orgId 포함 (organizations/{orgId}/customHolidays)
            expect(fs.collection).toHaveBeenCalledWith(
                expect.anything(), 'organizations', 'org1', 'customHolidays',
            );
            expect(fs.orderBy).toHaveBeenCalledWith('date', 'asc');
            expect(result).toEqual([{ id: 'h1', date: '2026-08-15', name: '기관 창립일' }]);
        });
    });

    describe('addCustomHoliday', () => {
        it('기관 서브컬렉션에 serverTimestamp를 포함해 추가하고 새 id를 반환한다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'h-new' } as never);

            const id = await addCustomHoliday('org1', { date: '2026-12-24', name: '재량 휴일' });

            expect(id).toBe('h-new');
            expect(fs.collection).toHaveBeenCalledWith(
                expect.anything(), 'organizations', 'org1', 'customHolidays',
            );
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    date: '2026-12-24',
                    name: '재량 휴일',
                    createdAt: '__serverTimestamp__',
                }),
            );
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.addDoc).mockRejectedValue(new Error('addDoc 실패') as never);

            await expect(addCustomHoliday('org1', {})).rejects.toThrow('addDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('deleteCustomHoliday', () => {
        it('기관 서브컬렉션 경로의 해당 휴일 문서를 삭제한다', async () => {
            vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);

            await deleteCustomHoliday('org1', 'h1');

            expect(fs.doc).toHaveBeenCalledWith(
                expect.anything(), 'organizations', 'org1', 'customHolidays', 'h1',
            );
            expect(fs.deleteDoc).toHaveBeenCalled();
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.deleteDoc).mockRejectedValue(new Error('deleteDoc 실패') as never);

            await expect(deleteCustomHoliday('org1', 'h1')).rejects.toThrow('deleteDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });
});
