import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase 모듈 모킹
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({
        withConverter: vi.fn().mockReturnThis(),
    })),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(),
    addDoc: vi.fn(),
    doc: vi.fn(() => ({ 
        id: 'mock-doc-id',
        withConverter: vi.fn().mockReturnThis(),
        ref: { id: 'mock-doc-id' }
    })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => new Date()),
    writeBatch: vi.fn(() => ({
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    })),
    runTransaction: vi.fn(),
    getCountFromServer: vi.fn(() => Promise.resolve({
        data: () => ({ count: 10 })
    })),
    onSnapshot: vi.fn(),
}));

vi.mock('../../lib/sentry', () => ({
    captureError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('../../lib/firebase', () => ({
    db: {},
    firebaseFunctions: {},
    auth: { currentUser: null },
    default: {},
}));

import { 
    getDocs, doc as _doc, 
    runTransaction, writeBatch 
} from 'firebase/firestore';
import { captureError } from '../../lib/sentry';

describe('Firestore 유틸리티 함수 - 에러 핸들링 및 롤백 검증', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('updateReservationStatus (트랜잭션 롤백 검증)', () => {
        it('예약이 존재하지 않으면 에러를 던지고 captureError를 호출한다', async () => {
            const { updateReservationStatus } = await import('../../lib/firestore/reservations');
            
            // runTransaction 모킹: 콜백을 실행하도록 설정
            vi.mocked(runTransaction).mockImplementation(async (db, cb) => {
                const mockTransaction = {
                    get: vi.fn().mockResolvedValue({ exists: () => false }), // 문서 없음
                    update: vi.fn(),
                    set: vi.fn(),
                    delete: vi.fn(),
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return cb(mockTransaction as any);
            });

            await expect(updateReservationStatus('res1', 'approved', {}, 'reserved'))
                .rejects.toThrow("예약 정보가 존재하지 않습니다.");

            expect(captureError).toHaveBeenCalled();
            expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({
                context: 'updateReservationStatus'
            });
        });

        it('동시성 충돌 발생 시(상태 불일치) 에러를 던지되 Sentry에는 보고하지 않는다', async () => {
            const { updateReservationStatus } = await import('../../lib/firestore/reservations');

            vi.mocked(runTransaction).mockImplementation(async (db, cb) => {
                const mockTransaction = {
                    get: vi.fn().mockResolvedValue({
                        exists: () => true,
                        data: () => ({ status: 'cancelled' }) // 기대한 'reserved'가 아님
                    }),
                    update: vi.fn(),
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return cb(mockTransaction as any);
            });

            await expect(updateReservationStatus('res1', 'approved', {}, 'reserved'))
                .rejects.toThrow("동시성 오류: 이미 다른 관리자에 의해 상태가 변경되었습니다. (현재 상태: cancelled)");

            // 예측 가능한 사용자 충돌이므로 Sentry 노이즈 방지 차원에서 captureError를 호출하지 않는다.
            expect(captureError).not.toHaveBeenCalled();
        });
    });

    describe('deleteOrganization (배치 롤백 검증)', () => {
        it('배치 커밋 실패 시 에러가 전파되고 captureError가 호출된다', async () => {
            const { deleteOrganization } = await import('../../lib/firestore/organizations');
            
            // 유저 0명으로 설정하여 배치 호출까지 가도록 함
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(getDocs).mockResolvedValue({ docs: [] } as any);
            
            const mockBatch = {
                delete: vi.fn(),
                update: vi.fn(),
                commit: vi.fn().mockRejectedValue(new Error("Firebase Permission Denied")),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(writeBatch).mockReturnValue(mockBatch as any);

            await expect(deleteOrganization('org1')).rejects.toThrow("Firebase Permission Denied");
            
            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({ context: 'deleteOrganization' })
            );
        });
    });

    // 기존의 기본적인 쿼리 테스트들 유지/보강
    describe('getDriveLogs 에러 핸들링', () => {
        it('Firestore 조회 실패 시 에러를 캡처하고 다시 던진다', async () => {
            vi.mocked(getDocs).mockRejectedValue(new Error("Network Error"));
            const { getDriveLogs } = await import('../../lib/firestore/driveLogs/queries');

            await expect(getDriveLogs('org1')).rejects.toThrow("Network Error");
            expect(captureError).toHaveBeenCalled();
        });
    });
});
