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
        withConverter: vi.fn().mockReturnThis()
    })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => new Date()),
    writeBatch: vi.fn(),
    onSnapshot: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('../../lib/firebase', () => ({
    db: {},
    default: {},
}));

import { getDocs, query as _query, collection as _collection, where as _where, orderBy as _orderBy, limit as _limit, addDoc, updateDoc, doc as _doc } from 'firebase/firestore';

describe('Firestore 유틸리티 함수', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getDriveLogs', () => {
        it('orgId로 운행일지를 조회한다', async () => {
            const mockDocs = [
                { id: 'log1', data: () => ({ id: 'log1', destination: '서울역', driverUid: 'user1' }) },
                { id: 'log2', data: () => ({ id: 'log2', destination: '강남역', driverUid: 'user2' }) },
            ];
            vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs } as ReturnType<typeof getDocs> extends Promise<infer R> ? R : never);

            const { getDriveLogs } = await import('../../lib/firestore');
            const result = await getDriveLogs('org1');

            expect(result.docs).toHaveLength(2);
            expect(result.docs[0].id).toBe('log1');
            expect(result.docs[0].destination).toBe('서울역');
            expect(result.hasMore).toBeDefined();
        });
    });

    describe('getMyDriveLogs', () => {
        it('orgId와 uid로 내 운행일지를 조회한다', async () => {
            const mockDocs = [
                { id: 'log1', data: () => ({ destination: '시청', driverUid: 'user1' }) },
            ];
            vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs } as ReturnType<typeof getDocs> extends Promise<infer R> ? R : never);

            const { getMyDriveLogs } = await import('../../lib/firestore');
            const result = await getMyDriveLogs('org1', 'user1', 10);

            expect(result).toHaveLength(1);
            expect(result[0].destination).toBe('시청');
        });
    });

    describe('createDriveLog', () => {
        it('운행일지를 생성한다', async () => {
            vi.mocked(addDoc).mockResolvedValue({ id: 'newLog1' } as ReturnType<typeof addDoc> extends Promise<infer R> ? R : never);

            const { createDriveLog } = await import('../../lib/firestore');
            const _result = await createDriveLog({
                destination: '부산',
                driverUid: 'user1',
                organizationId: 'org1',
            });

            expect(addDoc).toHaveBeenCalled();
        });
    });

    describe('getVehicles', () => {
        it('orgId로 차량 목록을 조회한다', async () => {
            const mockDocs = [
                { id: 'v1', data: () => ({ displayName: '소나타2744', plateNumber: '12가3456', fuelType: 'gasoline' }) },
                { id: 'v2', data: () => ({ displayName: '아이오닉5', plateNumber: '78나9012', fuelType: 'electric' }) },
            ];
            vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs } as ReturnType<typeof getDocs> extends Promise<infer R> ? R : never);

            const { getVehicles } = await import('../../lib/firestore');
            const result = await getVehicles('org1');

            expect(result).toHaveLength(2);
            expect(result[0].displayName).toBe('소나타2744');
            expect(result[1].fuelType).toBe('electric');
        });
    });

    describe('createReservation', () => {
        it('차량 예약을 생성한다', async () => {
            vi.mocked(addDoc).mockResolvedValue({ id: 'res1' } as ReturnType<typeof addDoc> extends Promise<infer R> ? R : never);

            const { createReservation } = await import('../../lib/firestore');
            await createReservation({
                vehicleId: 'v1',
                userId: 'user1',
                date: '2026-02-23',
                startTime: '09:00',
                endTime: '10:00',
                organizationId: 'org1',
            });

            expect(addDoc).toHaveBeenCalled();
            const callArgs = vi.mocked(addDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
            expect(callArgs.status).toBe('reserved');
        });
    });

    describe('cancelReservation', () => {
        it('예약을 취소 처리한다', async () => {
            vi.mocked(updateDoc).mockResolvedValue(undefined);

            const { cancelReservation } = await import('../../lib/firestore');
            await cancelReservation('res1');

            expect(updateDoc).toHaveBeenCalled();
            const callArgs = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
            expect(callArgs.status).toBe('cancelled');
        });
    });

    describe('createFeedback', () => {
        it('피드백을 생성한다', async () => {
            vi.mocked(addDoc).mockResolvedValue({ id: 'fb1' } as ReturnType<typeof addDoc> extends Promise<infer R> ? R : never);

            const { createFeedback } = await import('../../lib/firestore');
            await createFeedback({
                message: '기능 개선 요청',
                userEmail: 'test@test.com',
                userName: '테스트',
                imageUrls: [],
                organizationId: 'org1',
                authorUid: 'user1',
            });

            expect(addDoc).toHaveBeenCalled();
            const callArgs = vi.mocked(addDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
            expect(callArgs.status).toBe('unread');
            expect(callArgs.message).toBe('기능 개선 요청');
        });
    });

    describe('getFavorites', () => {
        it('사용자의 즐겨찾기를 조회한다', async () => {
            const mockDocs = [
                { id: 'fav1', data: () => ({ name: '김OO 어르신 댁', address: '서울시 강남구', userId: 'user1' }) },
            ];
            vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs } as ReturnType<typeof getDocs> extends Promise<infer R> ? R : never);

            const { getFavorites } = await import('../../lib/firestore');
            const result = await getFavorites('user1');

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('김OO 어르신 댁');
        });
    });
});
