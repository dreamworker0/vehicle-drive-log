/**
 * firestore/vehicles 도메인 함수 단위 테스트
 * 데이터 접근 계층(CRUD)의 쿼리 구성·캐시 무효화·에러 보고를 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── firebase/firestore 원시 함수 mock ──
// collection()/doc()는 .withConverter()로 체이닝되므로, 자기 자신을 반환하는 ref 스텁을 만든다.
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
// cache는 실제 TTL을 우회: cachedQuery는 fetcher를 즉시 실행, invalidateCache는 호출만 기록
vi.mock('../../../lib/firestore/cache', () => ({
    cachedQuery: vi.fn((_key: string, fetcher: () => unknown) => fetcher()),
    invalidateCache: vi.fn(),
}));

// mock 선언 뒤에 import (호이스팅 주의)
import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/sentry';
import { invalidateCache } from '../../../lib/firestore/cache';
import {
    getVehicles, createVehicle, updateVehicle,
    deleteVehicle, retireVehicle, restoreVehicle,
} from '../../../lib/firestore/vehicles';

// getDocs가 반환하는 스냅샷 스텁 헬퍼
const docsSnap = (rows: unknown[]) => ({ docs: rows.map(r => ({ data: () => r })) });

describe('firestore/vehicles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getVehicles', () => {
        it('orgId로 필터링하고 최신순으로 조회해 목록을 반환한다', async () => {
            const rows = [{ id: 'v1', name: '소나타' }, { id: 'v2', name: '아이오닉5' }];
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap(rows) as never);

            const result = await getVehicles('org1');

            expect(result).toHaveLength(2);
            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리 규칙
            expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        });
    });

    describe('createVehicle', () => {
        it('currentKm 미지정 시 0으로 채우고 serverTimestamp를 기록한 뒤 새 id를 반환한다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'v-new' } as never);

            const id = await createVehicle({ name: '스타렉스', organizationId: 'org1' });

            expect(id).toBe('v-new');
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ currentKm: 0, createdAt: '__serverTimestamp__' }),
            );
            expect(invalidateCache).toHaveBeenCalledWith('vehicles');
        });

        it('currentKm이 지정되면 그 값을 유지한다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValue({ id: 'v-new' } as never);

            await createVehicle({ name: '카니발', currentKm: 12345 });

            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ currentKm: 12345 }),
            );
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            const boom = new Error('addDoc 실패');
            vi.mocked(fs.addDoc).mockRejectedValue(boom as never);

            await expect(createVehicle({ name: 'x' })).rejects.toThrow('addDoc 실패');
            expect(captureError).toHaveBeenCalled();
            expect(invalidateCache).not.toHaveBeenCalled();
        });
    });

    describe('updateVehicle', () => {
        it('전달한 데이터로 updateDoc를 호출하고 캐시를 무효화한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await updateVehicle('v1', { name: '소나타(신)' });

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'vehicles', 'v1');
            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { name: '소나타(신)' },
            );
            expect(invalidateCache).toHaveBeenCalledWith('vehicles');
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValue(new Error('updateDoc 실패') as never);

            await expect(updateVehicle('v1', {})).rejects.toThrow('updateDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('deleteVehicle', () => {
        it('해당 문서를 삭제하고 캐시를 무효화한다', async () => {
            vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);

            await deleteVehicle('v1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'vehicles', 'v1');
            expect(fs.deleteDoc).toHaveBeenCalled();
            expect(invalidateCache).toHaveBeenCalledWith('vehicles');
        });
    });

    describe('retireVehicle', () => {
        it('retired 객체(사유·시각 포함)로 갱신하고 캐시를 무효화한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await retireVehicle('v1', '노후 폐차');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    retired: {
                        isRetired: true,
                        reason: '노후 폐차',
                        retiredAt: '__serverTimestamp__',
                    },
                }),
            );
            expect(invalidateCache).toHaveBeenCalledWith('vehicles');
        });

        it('사유 미지정 시 빈 문자열로 기록한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await retireVehicle('v1');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    retired: expect.objectContaining({ isRetired: true, reason: '' }),
                }),
            );
        });
    });

    describe('restoreVehicle', () => {
        it('retired를 null로 초기화하고 캐시를 무효화한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await restoreVehicle('v1');

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { retired: null },
            );
            expect(invalidateCache).toHaveBeenCalledWith('vehicles');
        });
    });
});
