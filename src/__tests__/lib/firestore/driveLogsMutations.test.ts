/**
 * firestore/driveLogs/mutations 도메인 함수 단위 테스트
 * 운행일지 쓰기(CQRS 쓰기 측) — 온라인/오프라인 분기, 오프라인 큐(enqueue),
 * 직전 기록 일치 확인(REQUIRES_START_KM_CONFIRMATION) 비즈니스 에러를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── firebase/firestore 원시 함수 mock ──
// createDriveLog가 docRef.id를 사용하므로 ref에 id를 부여한다 (경로 마지막 세그먼트 또는 자동 id)
const makeRef = (label: string, id?: string) => {
    const ref: { id: string; label: string; withConverter: (...a: unknown[]) => unknown } = {
        id: id ?? 'auto-id',
        label,
        withConverter: () => ref,
    };
    return ref;
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, ...path: string[]) => makeRef(`col:${path.join('/')}`)),
    doc: vi.fn((_db: unknown, ...path: string[]) => makeRef(`doc:${path.join('/')}`, path[path.length - 1])),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    // 오프라인 경로가 반환값에 .catch()를 붙이므로 반드시 resolved Promise 반환
    addDoc: vi.fn(() => Promise.resolve({ id: 'new-id' })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    runTransaction: vi.fn(),
    writeBatch: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
    Timestamp: class {},
}));

// ── 앱 모듈 mock ──
vi.mock('../../../lib/firebase', () => ({ db: {}, firebaseFunctions: {}, auth: { currentUser: null } }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('../../../lib/firestore/cache', () => ({
    cachedQuery: vi.fn((_k: string, f: () => unknown) => f()),
    invalidateCache: vi.fn(),
}));
// 오프라인 큐 — idb 실제 접근 회피(미mock 시 hang), 호출만 기록
vi.mock('../../../lib/offline/syncQueue', () => ({ enqueue: vi.fn() }));
// utils: 직전 기록 확인 분기는 기본 꺼짐(null), sanitizeUndefined는 passthrough
vi.mock('../../../lib/firestore/driveLogs/utils', () => ({
    sanitizeUndefined: (x: unknown) => x,
    getVehicleEndKmBefore: vi.fn().mockResolvedValue(null),
}));

// mock 선언 뒤에 import (호이스팅 주의)
import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/sentry';
import { invalidateCache } from '../../../lib/firestore/cache';
import { enqueue } from '../../../lib/offline/syncQueue';
import { getVehicleEndKmBefore } from '../../../lib/firestore/driveLogs/utils';
import { createDriveLog, updateDriveLog, deleteDriveLog } from '../../../lib/firestore/driveLogs/mutations';

// ── navigator.onLine 제어 헬퍼 ──
const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
};

describe('firestore/driveLogs/mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks는 구현까지 지우므로 Promise 반환·기본값을 재설정
        vi.mocked(fs.setDoc).mockResolvedValue(undefined as never);
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);
        vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);
        vi.mocked(getVehicleEndKmBefore).mockResolvedValue(null);
        setOnline(true);
    });
    afterEach(() => { setOnline(true); });

    describe('createDriveLog', () => {
        it('온라인: setDoc로 저장하고 캐시를 무효화한 뒤 id를 반환한다', async () => {
            const result = await createDriveLog({ organizationId: 'org1', vehicleId: 'v1', startKm: 100, endKm: 200 });

            expect(fs.setDoc).toHaveBeenCalled();
            expect(enqueue).not.toHaveBeenCalled();
            expect(result.id).toBeDefined();
            expect(result.syncResult).toBeNull();
            expect(invalidateCache).toHaveBeenCalledWith('driveLogs');
        });

        it('직전 기록 endKm과 startKm이 다르면 REQUIRES_START_KM_CONFIRMATION 에러를 던진다', async () => {
            vi.mocked(getVehicleEndKmBefore).mockResolvedValueOnce(150); // 직전 도착 150 ≠ 출발 100

            await expect(createDriveLog({
                organizationId: 'org1', vehicleId: 'v1', startKm: 100, endKm: 200, timestamp: new Date(),
            })).rejects.toMatchObject({ code: 'REQUIRES_START_KM_CONFIRMATION', suggestedStartKm: 150, originalStartKm: 100 });

            // 의도된 비즈니스 에러("일치하지 않습니다")라 Sentry 미보고, 저장도 안 됨
            expect(captureError).not.toHaveBeenCalled();
            expect(fs.setDoc).not.toHaveBeenCalled();
        });

        it('직전 기록 endKm과 startKm이 같으면 확인 없이 저장한다', async () => {
            vi.mocked(getVehicleEndKmBefore).mockResolvedValueOnce(100); // 직전 도착 == 출발

            await createDriveLog({
                organizationId: 'org1', vehicleId: 'v1', startKm: 100, endKm: 200, timestamp: new Date(),
            });

            expect(fs.setDoc).toHaveBeenCalled();
        });

        it('오프라인: setDoc를 await하지 않고 enqueue(CREATE)에 쌓는다 (직전 기록 확인도 생략)', async () => {
            setOnline(false);

            await createDriveLog({ organizationId: 'org1', vehicleId: 'v1', startKm: 100, endKm: 200, timestamp: new Date() });

            expect(getVehicleEndKmBefore).not.toHaveBeenCalled(); // 오프라인은 확인 분기 생략
            expect(enqueue).toHaveBeenCalledWith('CREATE', 'driveLogs', expect.any(String), expect.any(Object));
            expect(invalidateCache).toHaveBeenCalledWith('driveLogs');
        });

        it('클라이언트 결정론적 id가 오면 그 id로 문서를 만든다 (오프라인 멱등성)', async () => {
            const result = await createDriveLog({ id: 'det-id-1', organizationId: 'org1', vehicleId: 'v1', startKm: 1, endKm: 2 } as never);

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'driveLogs', 'det-id-1');
            expect(result.id).toBe('det-id-1');
        });

        it('일반 저장 실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.setDoc).mockRejectedValueOnce(new Error('permission-denied') as never);

            await expect(createDriveLog({ organizationId: 'org1', vehicleId: 'v1', startKm: 1, endKm: 2 }))
                .rejects.toThrow('permission-denied');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('updateDriveLog', () => {
        it('온라인: editedAt(serverTimestamp)을 병합해 updateDoc하고 캐시를 무효화한다', async () => {
            const result = await updateDriveLog('log1', { endKm: 300 });

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'driveLogs', 'log1');
            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ endKm: 300, editedAt: '__serverTimestamp__' }),
            );
            expect(enqueue).not.toHaveBeenCalled();
            expect(invalidateCache).toHaveBeenCalledWith('driveLogs');
            expect(result.syncResult).toBeNull();
        });

        it('오프라인: enqueue(UPDATE)에 쌓는다', async () => {
            setOnline(false);

            await updateDriveLog('log1', { endKm: 300 });

            expect(enqueue).toHaveBeenCalledWith('UPDATE', 'driveLogs', 'log1', expect.objectContaining({ endKm: 300 }));
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.updateDoc).mockRejectedValueOnce(new Error('updateDoc 실패') as never);

            await expect(updateDriveLog('log1', {})).rejects.toThrow('updateDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('deleteDriveLog', () => {
        it('온라인: 문서를 삭제하고 캐시를 무효화한다', async () => {
            await deleteDriveLog('log1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'driveLogs', 'log1');
            expect(fs.deleteDoc).toHaveBeenCalled();
            expect(enqueue).not.toHaveBeenCalled();
            expect(invalidateCache).toHaveBeenCalledWith('driveLogs');
        });

        it('오프라인: enqueue(DELETE, docId, null)에 쌓는다', async () => {
            setOnline(false);

            await deleteDriveLog('log1');

            expect(enqueue).toHaveBeenCalledWith('DELETE', 'driveLogs', 'log1', null);
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.deleteDoc).mockRejectedValueOnce(new Error('deleteDoc 실패') as never);

            await expect(deleteDriveLog('log1')).rejects.toThrow('deleteDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });
});
