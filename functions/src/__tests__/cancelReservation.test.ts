/**
 * cancelReservation.test.ts — 취소 대상 후보 조회 (조직·소유자·상태 필터)
 * Firestore where/get는 mock. getSeoulNow는 실제 사용(Gemini는 미호출이라 mock).
 */
jest.mock('../core/gemini', () => ({
    generateAiContent: jest.fn(),
}));

let reservationDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
const mockGet = jest.fn(async () => ({ docs: reservationDocs }));
const mockWhere = jest.fn().mockReturnThis();
const mockChain = { where: mockWhere, get: mockGet };
const mockCollection = jest.fn(() => mockChain);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
}));

import { findCancelCandidates } from "../services/assistant/cancelReservation";

function res(id: string, data: Record<string, unknown>) {
    return { id, data: () => data };
}

const BASE = { organizationId: 'org1', reservedByUid: 'user1', vehicleId: 'v1', vehicleName: '스타렉스', startTime: '14:00', endTime: '16:00' };

describe('findCancelCandidates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        reservationDocs = [];
    });

    it('조직·소유자로 쿼리한다 (격리)', async () => {
        await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: null });

        expect(mockWhere).toHaveBeenCalledWith('organizationId', '==', 'org1');
        expect(mockWhere).toHaveBeenCalledWith('reservedByUid', '==', 'user1');
    });

    it('날짜 단서가 있으면 date 등가 조건으로 조회한다', async () => {
        await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: null });
        expect(mockWhere).toHaveBeenCalledWith('date', '==', '2026-07-20');
    });

    it('날짜 단서가 없으면 오늘 이후(>=) 예정 건만 조회한다', async () => {
        await findCancelCandidates('org1', 'user1', { date: null, vehicleId: null, startTime: null });
        const dateCall = mockWhere.mock.calls.find((c) => c[0] === 'date');
        expect(dateCall?.[1]).toBe('>=');
    });

    it('취소 가능 상태(pending·reserved)만 후보로 남긴다', async () => {
        reservationDocs = [
            res('r1', { ...BASE, date: '2026-07-20', status: 'reserved' }),
            res('r2', { ...BASE, date: '2026-07-20', status: 'pending' }),
            res('r3', { ...BASE, date: '2026-07-20', status: 'completed' }),
            res('r4', { ...BASE, date: '2026-07-20', status: 'cancelled' }),
            res('r5', { ...BASE, date: '2026-07-20', status: 'rejected' }),
        ];

        const result = await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: null });

        expect(result.map((c) => c.id).sort()).toEqual(['r1', 'r2']);
    });

    it('차량 단서가 있으면 해당 차량으로 좁힌다', async () => {
        reservationDocs = [
            res('r1', { ...BASE, vehicleId: 'v1', date: '2026-07-20', status: 'reserved' }),
            res('r2', { ...BASE, vehicleId: 'v2', date: '2026-07-20', status: 'reserved' }),
        ];

        const result = await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: 'v1', startTime: null });

        expect(result.map((c) => c.id)).toEqual(['r1']);
    });

    it('시작시간 단서가 있으면 해당 시간으로 좁힌다', async () => {
        reservationDocs = [
            res('r1', { ...BASE, startTime: '14:00', date: '2026-07-20', status: 'reserved' }),
            res('r2', { ...BASE, startTime: '09:00', date: '2026-07-20', status: 'reserved' }),
        ];

        const result = await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: '09:00' });

        expect(result.map((c) => c.id)).toEqual(['r2']);
    });

    it('후보 필드를 표시용으로 매핑한다', async () => {
        reservationDocs = [res('r1', { ...BASE, date: '2026-07-20', status: 'reserved' })];

        const result = await findCancelCandidates('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: null });

        expect(result[0]).toEqual({
            id: 'r1', vehicleId: 'v1', vehicleName: '스타렉스',
            date: '2026-07-20', startTime: '14:00', endTime: '16:00',
        });
    });
});
