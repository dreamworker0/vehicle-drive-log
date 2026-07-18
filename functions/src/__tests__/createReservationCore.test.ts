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
const mockTransactionSet = jest.fn();
const mockTransactionUpdate = jest.fn().mockResolvedValue(undefined);
const mockTransaction = {
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
};
const mockRunTransaction = jest.fn(async (fn: (t: any) => Promise<any>) => fn(mockTransaction));
const mockWhere = jest.fn().mockReturnThis();
const mockDoc = jest.fn(() => ({ id: 'new-reservation-id' }));
const mockCollectionRef = {
    doc: mockDoc,
    where: mockWhere,
};
const mockCollection = jest.fn(() => mockCollectionRef);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

import { createReservationTx } from "../services/reservation/createReservationCore";

describe('createReservationTx (코어)', () => {
    const validInput = {
        organizationId: 'org1',
        vehicleId: 'v1',
        vehicleName: '소나타',
        reservedByName: '홍길동',
        date: '2026-03-05',
        startTime: '09:00',
        endTime: '12:00',
        purpose: '업무',
        destination: '서울역',
        actorUid: 'user1',
        actorOrgId: 'org1',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('actorOrgId가 organizationId와 다르면 permission-denied를 던진다', async () => {
        await expect(
            createReservationTx({ ...validInput, actorOrgId: 'org-OTHER' })
        ).rejects.toThrow('자기 기관의 차량만');
        expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it('actorOrgId가 없으면(비소속) permission-denied를 던진다', async () => {
        await expect(
            createReservationTx({ ...validInput, actorOrgId: undefined })
        ).rejects.toThrow('자기 기관의 차량만');
    });

    it('필수 필드 누락 시 invalid-argument를 던진다', async () => {
        await expect(
            createReservationTx({ ...validInput, vehicleId: '' })
        ).rejects.toThrow('필수입니다');
    });

    it('시작 시간이 종료 시간보다 늦으면 에러를 던진다', async () => {
        await expect(
            createReservationTx({ ...validInput, startTime: '14:00', endTime: '12:00' })
        ).rejects.toThrow('시작 시간은 종료 시간보다 빨라야');
    });

    it('겹치는 예약이 없으면 생성하고 reservationId와 status를 반환한다', async () => {
        mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] });

        const result = await createReservationTx(validInput);

        expect(result).toEqual({ reservationId: 'new-reservation-id', status: 'reserved' });
        expect(mockTransactionSet).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                organizationId: 'org1',
                reservedByUid: 'user1',
                status: 'reserved',
            })
        );
    });

    it('기관이 승인제(requireReservationApproval)면 pending으로 생성한다', async () => {
        // 1st get: 차량, 2nd get: org, 3rd get: 예약 쿼리 — org 스냅샷에 승인제 플래그
        mockTransactionGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] })
            .mockResolvedValueOnce({ exists: true, data: () => ({ requireReservationApproval: true }), docs: [] })
            .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] });

        const result = await createReservationTx(validInput);

        expect(result.status).toBe('pending');
        expect(mockTransactionSet).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ status: 'pending' })
        );
    });

    it('시간이 겹치는 예약이 있으면 already-exists를 던진다', async () => {
        const existingReservation = {
            data: () => ({ status: 'reserved', startTime: '10:00', endTime: '11:00' }),
        };
        mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [existingReservation] });

        await expect(createReservationTx(validInput)).rejects.toThrow('이미 예약되어 있습니다');
    });

    it('allowedUserIds 제한은 actorUid 기준으로 검증한다', async () => {
        mockTransactionGet.mockResolvedValue({
            exists: true,
            data: () => ({ organizationId: 'org1', allowedUserIds: ['other-user'] }),
            docs: [],
        });

        await expect(createReservationTx(validInput)).rejects.toThrow('지정된 직원만');
        expect(mockTransactionSet).not.toHaveBeenCalled();
    });

    it('HttpsError가 아닌 내부 오류는 internal로 정규화한다', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('firestore down'));

        await expect(createReservationTx(validInput)).rejects.toThrow('예약 생성에 실패했습니다');
    });

    it('source 필드를 전달하면 문서에 기록한다 (봇 경유 식별)', async () => {
        mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] });

        await createReservationTx({ ...validInput, source: 'slack' });

        expect(mockTransactionSet).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ source: 'slack' })
        );
    });
});
