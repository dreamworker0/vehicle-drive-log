/**
 * firestore/fuelLogs 도메인 함수 단위 테스트
 * 주유 기록 CRUD와 기간 조회 상한 분기(화면 목록 200건 / 기간 조회 5,000건 + 도달 경고)를 고정한다.
 * (기간 상한은 Phase 71에서 조용한 금액 누락을 고친 비즈니스 로직)
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
import { toLocalDateStr } from '../../../lib/dateUtils'; // 실물 사용 — Date→문자열 변환 기대값 산출용
import { getFuelLogs, createFuelLog, deleteFuelLog, updateFuelLog } from '../../../lib/firestore/fuelLogs';

// {id, ...data} 병합 반환 함수용 스냅샷 스텁 (doc.id 포함)
const docsSnapWithId = (rows: Array<{ id: string; [k: string]: unknown }>) => ({
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});

describe('firestore/fuelLogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getFuelLogs', () => {
        it('기간 미지정 시 orgId 필터·최신순·200건 상한으로 조회한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([
                { id: 'fl1', fuelCost: 50000 },
            ]) as never);

            const result = await getFuelLogs('org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리 규칙
            expect(fs.where).toHaveBeenCalledTimes(1); // vehicleId·기간 조건 없음
            expect(fs.orderBy).toHaveBeenCalledWith('date', 'desc');
            expect(fs.limit).toHaveBeenCalledWith(200); // 화면 목록 상한
            expect(result).toEqual([{ id: 'fl1', fuelCost: 50000 }]);
        });

        it('vehicleId 지정 시 차량 필터를 추가한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([]) as never);

            await getFuelLogs('org1', 'v1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1');
            expect(fs.where).toHaveBeenCalledWith('vehicleId', '==', 'v1');
        });

        it('기간(문자열) 지정 시 date 범위 조건과 5,000건 상한을 적용한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([]) as never);

            await getFuelLogs('org1', null, { since: '2026-06-01', until: '2026-06-30' });

            expect(fs.where).toHaveBeenCalledWith('date', '>=', '2026-06-01');
            expect(fs.where).toHaveBeenCalledWith('date', '<=', '2026-06-30');
            expect(fs.limit).toHaveBeenCalledWith(5000); // 기간 조회 상한 (내보내기·월간보고서 조인용)
        });

        it('기간을 Date로 주면 로컬 날짜 문자열로 변환해 조회한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId([]) as never);
            const since = new Date(2026, 5, 1); // 2026-06-01 (로컬)

            await getFuelLogs('org1', null, { since });

            expect(fs.where).toHaveBeenCalledWith('date', '>=', toLocalDateStr(since));
        });

        it('기간 조회가 상한 5,000건에 도달하면 누락 가능 경고를 남긴다', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `fl${i}` }));
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId(rows) as never);

            const result = await getFuelLogs('org1', null, { since: '2020-01-01' });

            expect(result).toHaveLength(5000);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('상한 5000건에 도달'));
            warnSpy.mockRestore();
        });

        it('기간 미지정 목록 조회는 상한에 도달해도 경고하지 않는다', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const rows = Array.from({ length: 200 }, (_, i) => ({ id: `fl${i}` }));
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnapWithId(rows) as never);

            await getFuelLogs('org1');

            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('createFuelLog', () => {
        it('serverTimestamp를 포함해 addDoc를 호출하고 docRef를 반환한다', async () => {
            const docRef = { id: 'fl-new' };
            vi.mocked(fs.addDoc).mockResolvedValue(docRef as never);

            const result = await createFuelLog({ fuelCost: 60000, organizationId: 'org1' });

            expect(result).toBe(docRef);
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ fuelCost: 60000, createdAt: '__serverTimestamp__' }),
            );
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.addDoc).mockRejectedValue(new Error('addDoc 실패') as never);

            await expect(createFuelLog({ fuelCost: 1 })).rejects.toThrow('addDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });

    describe('updateFuelLog', () => {
        it('updatedAt(serverTimestamp)을 병합해 updateDoc를 호출한다', async () => {
            vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);

            await updateFuelLog('fl1', { fuelCost: 70000 });

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'fuelLogs', 'fl1');
            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ fuelCost: 70000, updatedAt: '__serverTimestamp__' }),
            );
        });
    });

    describe('deleteFuelLog', () => {
        it('해당 주유 기록 문서를 삭제한다', async () => {
            vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);

            await deleteFuelLog('fl1');

            expect(fs.doc).toHaveBeenCalledWith(expect.anything(), 'fuelLogs', 'fl1');
            expect(fs.deleteDoc).toHaveBeenCalled();
        });

        it('실패 시 captureError로 보고하고 에러를 재던진다', async () => {
            vi.mocked(fs.deleteDoc).mockRejectedValue(new Error('deleteDoc 실패') as never);

            await expect(deleteFuelLog('fl1')).rejects.toThrow('deleteDoc 실패');
            expect(captureError).toHaveBeenCalled();
        });
    });
});
