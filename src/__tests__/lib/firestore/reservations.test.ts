/**
 * firestore/reservations 도메인 함수 단위 테스트
 * 예약 CRUD·조회 필터(org 격리)·비-트랜잭션 상태 변경(온/오프라인)·그룹 배치 액션·콜러블을 고정한다.
 *
 * 중복 주의: updateReservationStatus의 "트랜잭션 경로" 에러 2건(문서 없음·동시성 충돌)은
 * 기존 src/__tests__/lib/firestore.test.ts가 담당한다 — 여기서는 비-트랜잭션 경로와
 * rejectReservation 성공 경로만 다룬다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── firebase/firestore 원시 함수 mock (driveLogsMutations.test.ts와 동일 하네스) ──
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

vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn(),
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

// mock 선언 뒤에 import (호이스팅 주의)
import * as fs from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { captureError } from '../../../lib/sentry';
import { enqueue } from '../../../lib/offline/syncQueue';
import {
    getReservationById, getReservationByIdAndOrg, createReservation,
    getReservations, getPendingReservations, cancelReservation, updateReservation,
    updateReservationStatus, rejectReservation,
    getTodayReservations, getWeekReservations, getMyRecentReservations,
    getReservationsByGroupId, cancelReservationGroup, deleteReservationGroup,
    createReservationSafe,
} from '../../../lib/firestore/reservations';

// 스냅샷 스텁 헬퍼
const docsSnap = (rows: unknown[]) => ({ docs: rows.map(r => ({ data: () => r })) });
const getDocSnap = (data: unknown | null) => ({ exists: () => data !== null, data: () => data });

// ── navigator.onLine 제어 헬퍼 ──
const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
};

describe('firestore/reservations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks는 구현까지 지우므로 Promise 반환을 재설정
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined as never);
        vi.mocked(fs.deleteDoc).mockResolvedValue(undefined as never);
        setOnline(true);
    });
    afterEach(() => { setOnline(true); });

    // ── 보안: org 격리 (최우선) ──
    describe('getReservationByIdAndOrg', () => {
        it('조회한 예약의 organizationId가 일치하면 데이터를 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ organizationId: 'org1', status: 'reserved' }) as never);

            expect(await getReservationByIdAndOrg('r1', 'org1')).toMatchObject({ organizationId: 'org1' });
        });

        it('organizationId가 다르면 null을 반환한다 (교차 테넌트 차단)', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap({ organizationId: 'other', status: 'reserved' }) as never);

            expect(await getReservationByIdAndOrg('r1', 'org1')).toBeNull();
        });

        it('문서가 없으면 null을 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValue(getDocSnap(null) as never);

            expect(await getReservationByIdAndOrg('r1', 'org1')).toBeNull();
        });
    });

    describe('getReservationById', () => {
        it('문서가 있으면 데이터, 없으면 null을 반환한다', async () => {
            vi.mocked(fs.getDoc).mockResolvedValueOnce(getDocSnap({ status: 'reserved' }) as never);
            expect(await getReservationById('r1')).toMatchObject({ status: 'reserved' });

            vi.mocked(fs.getDoc).mockResolvedValueOnce(getDocSnap(null) as never);
            expect(await getReservationById('none')).toBeNull();
        });
    });

    describe('createReservation', () => {
        const base = { organizationId: 'org1', vehicleId: 'v1', date: '2026-08-01', startTime: '09:00', endTime: '10:00', reservedByUid: 'u1' };

        it('기본(승인 불필요)은 status reserved로 addDoc하고 새 id를 반환한다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValueOnce({ id: 'r-new' } as never);

            const id = await createReservation(base);

            expect(id).toBe('r-new');
            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ status: 'reserved', createdAt: '__serverTimestamp__', expiresAt: expect.any(Date) }),
            );
        });

        it('requireApproval=true면 status pending으로 생성한다', async () => {
            vi.mocked(fs.addDoc).mockResolvedValueOnce({ id: 'r-new' } as never);

            await createReservation(base, true);

            expect(fs.addDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ status: 'pending' }),
            );
        });
    });

    describe('getReservations', () => {
        it('date 지정 시 org 필터 + date 일치 조건으로 조회한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([{ id: 'r1' }]) as never);

            await getReservations('org1', '2026-08-01');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(fs.where).toHaveBeenCalledWith('date', '==', '2026-08-01');
        });

        it('date 미지정 시 최근 1개월 범위 조건을 적용한다 (읽기 비용 절감)', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([]) as never);

            await getReservations('org1');

            expect(fs.where).toHaveBeenCalledWith('date', '>=', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
        });
    });

    describe('getPendingReservations', () => {
        it('org+pending 필터로 조회해 createdAt 오름차순(오래된 것 먼저)으로 정렬한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'b', createdAt: { toMillis: () => 200 } },
                { id: 'a', createdAt: { toMillis: () => 100 } },
                { id: 'c', createdAt: null }, // toMillis 없으면 0 취급
            ]) as never);

            const result = await getPendingReservations('org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(fs.where).toHaveBeenCalledWith('status', '==', 'pending');
            expect(result.map(r => r.id)).toEqual(['c', 'a', 'b']);
        });
    });

    describe('cancelReservation / updateReservation', () => {
        it('cancelReservation은 status cancelled로 갱신한다', async () => {
            await cancelReservation('r1');

            expect(fs.updateDoc).toHaveBeenCalledWith(expect.anything(), { status: 'cancelled' });
        });

        it('updateReservation은 전달한 데이터로 updateDoc를 호출한다', async () => {
            await updateReservation('r1', { destination: '복지관' });

            expect(fs.updateDoc).toHaveBeenCalledWith(expect.anything(), { destination: '복지관' });
        });
    });

    // ── updateReservationStatus 비-트랜잭션 경로 (트랜잭션 에러 경로는 firestore.test.ts 담당) ──
    describe('updateReservationStatus (expectedCurrentStatus 없음)', () => {
        it('온라인: 트랜잭션 없이 updateDoc로 상태를 갱신한다', async () => {
            await updateReservationStatus('r1', 'completed', { actualEndTime: '18:00' } as never);

            expect(fs.updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ status: 'completed', actualEndTime: '18:00' }),
            );
            expect(enqueue).not.toHaveBeenCalled();
            expect(fs.runTransaction).not.toHaveBeenCalled();
        });

        it('오프라인: enqueue(UPDATE)에 쌓는다 (낙관적 업데이트)', async () => {
            setOnline(false);

            await updateReservationStatus('r1', 'completed');

            expect(enqueue).toHaveBeenCalledWith('UPDATE', 'reservations', 'r1', expect.objectContaining({ status: 'completed' }));
            expect(fs.runTransaction).not.toHaveBeenCalled();
        });
    });

    // ── rejectReservation: 트랜잭션 성공 경로 ──
    describe('rejectReservation', () => {
        it('pending 예약을 rejected로 바꾸고 사유·반려 시각을 기록한다', async () => {
            const update = vi.fn();
            vi.mocked(fs.runTransaction).mockImplementation((async (_db: unknown, cb: (t: unknown) => unknown) =>
                cb({ get: async () => ({ exists: () => true, data: () => ({ status: 'pending' }) }), update })) as never);

            await rejectReservation('r1', '차량 점검');

            expect(update).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ status: 'rejected', rejectedReason: '차량 점검', rejectedAt: '__serverTimestamp__' }),
            );
        });
    });

    describe('getTodayReservations / getWeekReservations', () => {
        it('오늘 예약은 org+date 필터로 조회하고 취소 건을 제외한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'a', status: 'reserved' },
                { id: 'b', status: 'cancelled' },
            ]) as never);

            const result = await getTodayReservations('org1', '2026-08-01');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(fs.where).toHaveBeenCalledWith('date', '==', '2026-08-01');
            expect(result.map(r => r.id)).toEqual(['a']);
        });

        it('주간 예약은 date 범위 필터로 조회하고 취소 건을 제외한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'a', status: 'reserved' },
                { id: 'b', status: 'cancelled' },
            ]) as never);

            const result = await getWeekReservations('org1', '2026-08-01', '2026-08-07');

            expect(fs.where).toHaveBeenCalledWith('date', '>=', '2026-08-01');
            expect(fs.where).toHaveBeenCalledWith('date', '<=', '2026-08-07');
            expect(result).toHaveLength(1);
        });
    });

    describe('getMyRecentReservations', () => {
        it('org+본인 필터로 조회해 취소 제외·최신순 정렬·limitCount 상한을 적용한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'old', status: 'reserved', date: '2026-07-01', startTime: '09:00' },
                { id: 'cancelled', status: 'cancelled', date: '2026-07-05', startTime: '09:00' },
                { id: 'newest', status: 'reserved', date: '2026-07-06', startTime: '10:00' },
                { id: 'mid', status: 'reserved', date: '2026-07-03', startTime: '09:00' },
            ]) as never);

            const result = await getMyRecentReservations('org1', 'u1', 2);

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(fs.where).toHaveBeenCalledWith('reservedByUid', '==', 'u1');
            expect(result.map(r => r.id)).toEqual(['newest', 'mid']); // 최신순 + 상한 2
        });
    });

    describe('getReservationsByGroupId', () => {
        it('org+groupId 필터로 조회해 날짜 오름차순으로 반환한다', async () => {
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'b', date: '2026-08-02' },
                { id: 'a', date: '2026-08-01' },
            ]) as never);

            const result = await getReservationsByGroupId('g1', 'org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(fs.where).toHaveBeenCalledWith('groupId', '==', 'g1');
            expect(result.map(r => r.id)).toEqual(['a', 'b']);
        });
    });

    // ── batchGroupAction: 그룹 일괄 액션 (cancel/delete — recurring 2종은 fetch 함수만 다르고 동일 헬퍼라 생략) ──
    describe('cancelReservationGroup', () => {
        it('그룹 내 활성 예약만 batch.update(cancelled)하고 처리 건수를 반환한다', async () => {
            const update = vi.fn(), del = vi.fn(), commit = vi.fn().mockResolvedValue(undefined);
            vi.mocked(fs.writeBatch).mockReturnValue({ update, delete: del, commit } as never);
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'a', status: 'reserved', date: '2026-08-01' },
                { id: 'b', status: 'cancelled', date: '2026-08-02' }, // 이미 취소 → 제외
                { id: 'c', status: 'completed', date: '2026-08-03' }, // 완료 → 제외
            ]) as never);

            const count = await cancelReservationGroup('g1', 'org1');

            expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1'); // org 격리
            expect(update).toHaveBeenCalledTimes(1); // 활성 1건만
            expect(update).toHaveBeenCalledWith(expect.anything(), { status: 'cancelled' });
            expect(del).not.toHaveBeenCalled();
            expect(commit).toHaveBeenCalled();
            expect(count).toBe(1);
        });
    });

    describe('deleteReservationGroup', () => {
        it('그룹 내 활성 예약만 batch.delete하고 처리 건수를 반환한다', async () => {
            const update = vi.fn(), del = vi.fn(), commit = vi.fn().mockResolvedValue(undefined);
            vi.mocked(fs.writeBatch).mockReturnValue({ update, delete: del, commit } as never);
            vi.mocked(fs.getDocs).mockResolvedValue(docsSnap([
                { id: 'a', status: 'reserved', date: '2026-08-01' },
                { id: 'b', status: 'pending', date: '2026-08-02' },
                { id: 'c', status: 'cancelled', date: '2026-08-03' }, // 제외
            ]) as never);

            const count = await deleteReservationGroup('g1', 'org1');

            expect(del).toHaveBeenCalledTimes(2);
            expect(update).not.toHaveBeenCalled();
            expect(commit).toHaveBeenCalled();
            expect(count).toBe(2);
        });
    });

    // ── createReservationSafe: 서버 검증 콜러블 ──
    describe('createReservationSafe', () => {
        it('httpsCallable 결과의 reservationId를 반환한다', async () => {
            const callable = vi.fn().mockResolvedValue({ data: { reservationId: 'r-new' } });
            vi.mocked(httpsCallable).mockReturnValue(callable as never);

            expect(await createReservationSafe({ vehicleId: 'v1' })).toBe('r-new');
            // auth.currentUser가 null이면 토큰 갱신 분기는 건너뛴다 (기본 하네스)
        });

        it('기대되는 비즈니스 에러(already-exists)는 Sentry에 보고하지 않고 재던진다', async () => {
            const bizError = Object.assign(new Error('중복 예약'), { code: 'functions/already-exists' });
            const callable = vi.fn().mockRejectedValue(bizError);
            vi.mocked(httpsCallable).mockReturnValue(callable as never);

            await expect(createReservationSafe({ vehicleId: 'v1' })).rejects.toThrow('중복 예약');
            expect(captureError).not.toHaveBeenCalled();
        });

        it('예상 밖 에러는 captureError로 보고하고 재던진다', async () => {
            const callable = vi.fn().mockRejectedValue(new Error('internal'));
            vi.mocked(httpsCallable).mockReturnValue(callable as never);

            await expect(createReservationSafe({ vehicleId: 'v1' })).rejects.toThrow('internal');
            expect(captureError).toHaveBeenCalled();
        });
    });
});
