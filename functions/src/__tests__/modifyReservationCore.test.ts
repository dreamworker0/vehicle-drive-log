// ── HttpsError 캡처를 위한 Mock ──
class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: MockHttpsError,
}));

// ── Firestore Mock ──
const mockTransactionGet = jest.fn();
const mockTransactionUpdate = jest.fn().mockResolvedValue(undefined);
const mockTransaction = {
    get: mockTransactionGet,
    update: mockTransactionUpdate,
};
const mockRunTransaction = jest.fn(async (fn: (t: any) => Promise<any>) => fn(mockTransaction));
const mockDoc = jest.fn((id: string) => ({ id }));
const mockWhere = jest.fn().mockReturnThis();
const mockCollection = jest.fn(() => ({ doc: mockDoc, where: mockWhere }));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

import { modifyReservationTx } from "../services/reservation/modifyReservationCore";

const VALID = {
    reservationId: 'r1', actorUid: 'user1', actorOrgId: 'org1',
    date: '2026-07-21', startTime: '14:00', endTime: '16:00',
};

const TARGET = {
    organizationId: 'org1', reservedByUid: 'user1', status: 'reserved',
    vehicleId: 'v1', vehicleName: '스타렉스', date: '2026-07-20', startTime: '09:00', endTime: '10:00',
};

/** 3단계 get(예약 → 차량 → 겹침 쿼리)을 순서대로 세팅 */
function setup(opts: {
    reservation?: Record<string, unknown> | null;
    vehicle?: Record<string, unknown> | null;
    existing?: Array<{ id: string; data: () => Record<string, unknown> }>;
} = {}) {
    const reservationSnap = opts.reservation === null
        ? { exists: false }
        : { exists: true, data: () => opts.reservation ?? TARGET };
    const vehicleSnap = opts.vehicle === null
        ? { exists: false }
        : { exists: true, data: () => opts.vehicle ?? { organizationId: 'org1' } };
    mockTransactionGet
        .mockResolvedValueOnce(reservationSnap)
        .mockResolvedValueOnce(vehicleSnap)
        .mockResolvedValueOnce({ docs: opts.existing ?? [] });
}

describe('modifyReservationTx (코어)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks는 mockResolvedValueOnce 큐를 비우지 않으므로 get 큐를 명시적으로 리셋
        mockTransactionGet.mockReset();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('필수 인자가 없으면 invalid-argument를 던진다', async () => {
        await expect(modifyReservationTx({ ...VALID, date: '' })).rejects.toThrow('필수입니다');
        expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it('시작이 종료보다 늦으면 invalid-argument를 던진다', async () => {
        await expect(modifyReservationTx({ ...VALID, startTime: '16:00', endTime: '14:00' })).rejects.toThrow('빨라야');
    });

    it('예약이 없으면 not-found를 던진다', async () => {
        setup({ reservation: null });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('찾을 수 없습니다');
    });

    it('타 기관 예약이면 permission-denied를 던진다 (조직 격리)', async () => {
        setup({ reservation: { ...TARGET, organizationId: 'org-OTHER' } });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('자기 기관의 예약만');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('본인 예약이 아니면 permission-denied를 던진다 (소유자 검증)', async () => {
        setup({ reservation: { ...TARGET, reservedByUid: 'other' } });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('본인이 예약한');
    });

    it('취소·완료 등 수정 불가 상태면 failed-precondition을 던진다', async () => {
        setup({ reservation: { ...TARGET, status: 'completed' } });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('수정할 수 없는 상태');
    });

    it('차량이 타 기관 소속이면 permission-denied를 던진다', async () => {
        setup({ vehicle: { organizationId: 'org-OTHER' } });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('자기 기관의 차량만');
    });

    it('새 시간이 다른 예약과 겹치면 already-exists를 던진다', async () => {
        setup({
            existing: [
                { id: 'r2', data: () => ({ status: 'reserved', startTime: '15:00', endTime: '17:00' }) },
            ],
        });
        await expect(modifyReservationTx(VALID)).rejects.toThrow('이미 예약되어 있습니다');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('겹침 검사에서 자기 자신은 제외한다 (같은 시간대로 남겨도 통과)', async () => {
        // 자기 예약(r1)이 새 시간대와 겹쳐도 자신은 제외되어야 한다
        setup({
            existing: [
                { id: 'r1', data: () => ({ status: 'reserved', startTime: '14:00', endTime: '16:00' }) },
            ],
        });
        await expect(modifyReservationTx(VALID)).resolves.toBeDefined();
        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ date: '2026-07-21', startTime: '14:00', endTime: '16:00' })
        );
    });

    it('정상 수정 시 날짜·시간을 갱신하고 요약을 반환한다', async () => {
        setup({});
        const result = await modifyReservationTx(VALID);

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ date: '2026-07-21', startTime: '14:00', endTime: '16:00' })
        );
        expect(result).toEqual({
            vehicleName: '스타렉스', date: '2026-07-21', startTime: '14:00', endTime: '16:00',
        });
    });

    it('HttpsError가 아닌 내부 오류는 internal로 정규화한다', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('firestore down'));
        await expect(modifyReservationTx(VALID)).rejects.toThrow('예약 수정에 실패했습니다');
    });
});
