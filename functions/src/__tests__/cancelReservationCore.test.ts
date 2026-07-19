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
const mockDoc = jest.fn(() => ({ id: 'r1' }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

import { cancelReservationTx } from "../services/reservation/cancelReservationCore";

const VALID = { reservationId: 'r1', actorUid: 'user1', actorOrgId: 'org1' };

/** 예약 문서 스냅샷을 mock에 세팅 */
function setReservation(data: Record<string, unknown> | null) {
    mockTransactionGet.mockResolvedValue(
        data === null ? { exists: false } : { exists: true, data: () => data }
    );
}

const ACTIVE = {
    organizationId: 'org1', reservedByUid: 'user1', status: 'reserved',
    vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00',
};

describe('cancelReservationTx (코어)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('필수 인자가 없으면 invalid-argument를 던진다', async () => {
        await expect(cancelReservationTx({ ...VALID, reservationId: '' })).rejects.toThrow('필수입니다');
        expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it('예약이 없으면 not-found를 던진다', async () => {
        setReservation(null);
        await expect(cancelReservationTx(VALID)).rejects.toThrow('찾을 수 없습니다');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('타 기관 예약이면 permission-denied를 던진다 (조직 격리)', async () => {
        setReservation({ ...ACTIVE, organizationId: 'org-OTHER' });
        await expect(cancelReservationTx(VALID)).rejects.toThrow('자기 기관의 예약만');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('본인 예약이 아니면 permission-denied를 던진다 (소유자 검증)', async () => {
        setReservation({ ...ACTIVE, reservedByUid: 'other-user' });
        await expect(cancelReservationTx(VALID)).rejects.toThrow('본인이 예약한');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('이미 취소된 예약이면 failed-precondition을 던진다', async () => {
        setReservation({ ...ACTIVE, status: 'cancelled' });
        await expect(cancelReservationTx(VALID)).rejects.toThrow('이미 취소된');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('완료(completed)된 예약은 취소할 수 없다', async () => {
        setReservation({ ...ACTIVE, status: 'completed' });
        await expect(cancelReservationTx(VALID)).rejects.toThrow('취소할 수 없는 상태');
        expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('정상 취소 시 status를 cancelled로 바꾸고 요약을 반환한다', async () => {
        setReservation(ACTIVE);

        const result = await cancelReservationTx(VALID);

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'cancelled' })
        );
        expect(result).toEqual({
            vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00',
        });
    });

    it('pending 상태도 취소할 수 있다', async () => {
        setReservation({ ...ACTIVE, status: 'pending' });
        await expect(cancelReservationTx(VALID)).resolves.toBeDefined();
        expect(mockTransactionUpdate).toHaveBeenCalled();
    });

    it('HttpsError가 아닌 내부 오류는 internal로 정규화한다', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('firestore down'));
        await expect(cancelReservationTx(VALID)).rejects.toThrow('예약 취소에 실패했습니다');
    });
});
