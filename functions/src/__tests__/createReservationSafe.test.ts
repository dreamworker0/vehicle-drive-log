// ── onCall / HttpsError 캡처를 위한 Mock ──
let capturedHandler: any;

class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: any, handler: any) => {
        capturedHandler = handler;
    },
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

// 모듈 로드 (이 시점에서 capturedHandler가 설정됨)
require('../createReservationSafe');

describe('createReservationSafe', () => {
    const validRequest = {
        auth: { uid: 'user1', token: { orgId: 'org1' } },
        data: {
            organizationId: 'org1',
            vehicleId: 'v1',
            vehicleName: '소나타',
            reservedByUid: 'user1',
            reservedByName: '홍길동',
            date: '2026-03-05',
            startTime: '09:00',
            endTime: '12:00',
            purpose: '업무',
            destination: '서울역',
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
        // jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('인증 없이 호출하면 unauthenticated 에러를 던진다', async () => {
        const request = { ...validRequest, auth: null };
        await expect(capturedHandler(request)).rejects.toThrow('로그인이 필요합니다.');
    });

    it('필수 필드가 누락되면 invalid-argument 에러를 던진다', async () => {
        const request = {
            auth: { uid: 'user1', token: { orgId: 'org1' } },
            data: { organizationId: 'org1' },
        };
        await expect(capturedHandler(request)).rejects.toThrow('필수입니다');
    });

    it('시작 시간이 종료 시간보다 늦으면 에러를 던진다', async () => {
        const request = {
            ...validRequest,
            data: { ...validRequest.data, startTime: '14:00', endTime: '12:00' },
        };
        await expect(capturedHandler(request)).rejects.toThrow('시작 시간은 종료 시간보다 빨라야');
    });

    it('겹치는 예약이 없으면 정상 생성한다', async () => {
        mockTransactionGet.mockResolvedValue({ docs: [] });

        const result = await capturedHandler(validRequest);

        expect(result).toEqual({ success: true, reservationId: 'new-reservation-id' });
        expect(mockTransactionSet).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                organizationId: 'org1',
                vehicleId: 'v1',
                date: '2026-03-05',
                status: 'reserved',
            })
        );
    });

    it('시간이 겹치는 예약이 있으면 already-exists 에러를 던진다', async () => {
        const existingReservation = {
            data: () => ({
                status: 'reserved',
                startTime: '10:00',
                endTime: '11:00',
            }),
        };
        mockTransactionGet.mockResolvedValue({ docs: [existingReservation] });

        await expect(capturedHandler(validRequest)).rejects.toThrow('이미 예약되어 있습니다');
    });

    it('취소된 예약과는 시간이 겹쳐도 정상 생성한다', async () => {
        const cancelledReservation = {
            data: () => ({
                status: 'cancelled',
                startTime: '10:00',
                endTime: '11:00',
            }),
        };
        mockTransactionGet.mockResolvedValue({ docs: [cancelledReservation] });

        const result = await capturedHandler(validRequest);

        expect(result).toEqual({ success: true, reservationId: 'new-reservation-id' });
    });

    it('완료된 예약과는 시간이 겹쳐도 정상 생성한다', async () => {
        const completedReservation = {
            data: () => ({
                status: 'completed',
                startTime: '10:00',
                endTime: '11:00',
                actualStartTime: '07:00',
                actualEndTime: '08:00',
            }),
        };
        mockTransactionGet.mockResolvedValue({ docs: [completedReservation] });

        const result = await capturedHandler(validRequest);

        expect(result).toEqual({ success: true, reservationId: 'new-reservation-id' });
    });
});
