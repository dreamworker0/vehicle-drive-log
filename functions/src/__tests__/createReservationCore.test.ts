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
        // clearAllMocks는 mockResolvedValueOnce 큐를 지우지 않는다. 검증에서 조기 종료해
        // 큐가 남으면 **다음 테스트가 남의 스냅샷을 읽는다** — 순서 의존 실패의 원인이 된다.
        mockTransactionGet.mockReset();
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
        // 1st get: 차량, 2nd get: org, 3rd get: 차량 겹침 쿼리, 4th get: 명의자 겹침 쿼리
        mockTransactionGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] })
            .mockResolvedValueOnce({ exists: true, data: () => ({ requireReservationApproval: true }), docs: [] })
            .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] })
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

    // ── 한 사람은 같은 시간에 한 대만 ──
    describe('명의자 겹침 (한 사람 = 한 대)', () => {
        /** 차량 → 기관 → 차량 겹침(비어 있음) → 명의자 겹침(주어진 docs) */
        const mockOwnerOverlapGets = (ownerDocs: unknown[]) => {
            mockTransactionGet
                .mockResolvedValueOnce({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] })
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] })
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] })
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: ownerDocs });
        };

        it('같은 사람이 같은 시간에 다른 차량을 예약하면 already-exists를 던진다', async () => {
            mockOwnerOverlapGets([
                { data: () => ({ status: 'reserved', startTime: '10:00', endTime: '11:00', vehicleName: '카니발', reservedByName: '홍길동' }) },
            ]);

            await expect(createReservationTx(validInput)).rejects.toThrow('한 사람은 같은 시간에 한 대만');
            expect(mockTransactionSet).not.toHaveBeenCalled();
        });

        it('시간이 겹치지 않으면 같은 사람의 다른 예약이 있어도 생성한다', async () => {
            mockOwnerOverlapGets([
                { data: () => ({ status: 'reserved', startTime: '13:00', endTime: '14:00', vehicleName: '카니발' }) },
            ]);

            await expect(createReservationTx(validInput)).resolves.toMatchObject({ status: 'reserved' });
        });

        it('취소된 예약은 명의자 겹침으로 보지 않는다', async () => {
            mockOwnerOverlapGets([
                { data: () => ({ status: 'cancelled', startTime: '10:00', endTime: '11:00', vehicleName: '카니발' }) },
            ]);

            await expect(createReservationTx(validInput)).resolves.toMatchObject({ status: 'reserved' });
        });

        it('일찍 반납해 운행이 끝난 예약은 실제 운행 시간만 점유한다', async () => {
            // 09:00~12:00 예약을 09:00~09:30만 타고 완료 → 09:30부터는 본인도 다른 차를 잡을 수 있다
            mockOwnerOverlapGets([
                {
                    data: () => ({
                        status: 'completed', startTime: '09:00', endTime: '12:00',
                        actualStartTime: '09:00', actualEndTime: '09:30', vehicleName: '카니발',
                    }),
                },
            ]);

            await expect(
                createReservationTx({ ...validInput, startTime: '09:30', endTime: '12:00' })
            ).resolves.toMatchObject({ status: 'reserved' });
        });
    });

    it('allowedUserIds 제한은 명의자 기준으로 검증한다', async () => {
        mockTransactionGet.mockResolvedValue({
            exists: true,
            data: () => ({ organizationId: 'org1', allowedUserIds: ['other-user'] }),
            docs: [],
        });

        await expect(createReservationTx(validInput)).rejects.toThrow('지정된 직원만');
        expect(mockTransactionSet).not.toHaveBeenCalled();
    });

    // ── 대리 생성 (reservedByUid) — 관리자가 직원 예약을 대행·그룹 수정할 때 쓰인다 ──
    describe('reservedByUid (명의 지정)', () => {
        /** 대리 생성 경로의 get 순서: 차량 → 명의자 users 문서 → 기관 → 차량 겹침 → 명의자 겹침 */
        const mockOnBehalfGets = (ownerDoc: unknown, vehicleData: Record<string, unknown> = { organizationId: 'org1' }) => {
            mockTransactionGet
                .mockResolvedValueOnce({ exists: true, data: () => vehicleData, docs: [] })
                .mockResolvedValueOnce(ownerDoc)
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] })
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] })
                .mockResolvedValueOnce({ exists: true, data: () => ({}), docs: [] });
        };

        it('관리자가 아니면 다른 직원 명의로 만들 수 없다', async () => {
            await expect(
                createReservationTx({ ...validInput, actorRole: 'employee', reservedByUid: 'user2' })
            ).rejects.toThrow('기관 관리자만');
            // 트랜잭션에 들어가기 전에 막는다
            expect(mockRunTransaction).not.toHaveBeenCalled();
        });

        it('관리자는 직원 명의로 만들 수 있고 명의가 보존된다', async () => {
            // 이 보존이 없으면 관리자가 직원 그룹을 수정할 때 예약이 관리자 명의로 넘어간다
            mockOnBehalfGets({ exists: true, data: () => ({ organizationId: 'org1' }) });

            await createReservationTx({ ...validInput, actorRole: 'admin', reservedByUid: 'user2' });

            expect(mockTransactionSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ reservedByUid: 'user2' })
            );
        });

        it('명의자가 타 기관 구성원이면 거부한다', async () => {
            // Claims의 role만 믿으면 관리자가 임의 UID 명의로 예약을 심을 수 있다
            mockOnBehalfGets({ exists: true, data: () => ({ organizationId: 'org-OTHER' }) });

            await expect(
                createReservationTx({ ...validInput, actorRole: 'admin', reservedByUid: 'user2' })
            ).rejects.toThrow('같은 기관 구성원');
            expect(mockTransactionSet).not.toHaveBeenCalled();
        });

        it('명의자 문서가 없으면 거부한다', async () => {
            mockOnBehalfGets({ exists: false, data: () => undefined });

            await expect(
                createReservationTx({ ...validInput, actorRole: 'admin', reservedByUid: 'user2' })
            ).rejects.toThrow('같은 기관 구성원');
        });

        it('차량 사용 제한은 호출자가 아니라 명의자로 판정한다', async () => {
            // 실제 운행자는 명의자다. 관리자가 목록에 없어도 명의자가 있으면 통과해야 한다
            mockOnBehalfGets(
                { exists: true, data: () => ({ organizationId: 'org1' }) },
                { organizationId: 'org1', allowedUserIds: ['user2'] },
            );

            await createReservationTx({ ...validInput, actorRole: 'admin', reservedByUid: 'user2' });

            expect(mockTransactionSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ reservedByUid: 'user2' })
            );
        });

        it('명의자가 제한 목록에 없으면 거부한다 (위 케이스의 대조군)', async () => {
            mockOnBehalfGets(
                { exists: true, data: () => ({ organizationId: 'org1' }) },
                { organizationId: 'org1', allowedUserIds: ['user1'] }, // 호출자만 허용
            );

            await expect(
                createReservationTx({ ...validInput, actorRole: 'admin', reservedByUid: 'user2' })
            ).rejects.toThrow('지정된 직원만');
        });

        it('자기 명의를 명시적으로 넘기는 것은 대리 생성이 아니다', async () => {
            // 클라이언트가 항상 reservedByUid를 채워 보내도 역할 검사에 걸리지 않아야 한다
            mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] });

            await createReservationTx({ ...validInput, actorRole: 'employee', reservedByUid: 'user1' });

            expect(mockTransactionSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ reservedByUid: 'user1' })
            );
        });
    });

    it('HttpsError가 아닌 내부 오류는 internal로 정규화한다', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('firestore down'));

        await expect(createReservationTx(validInput)).rejects.toThrow('예약 생성에 실패했습니다');
    });

    describe('동승자(예정)', () => {
        it('전달한 동승자를 문서에 기록한다', async () => {
            mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] });

            await createReservationTx({
                ...validInput,
                passengerUids: ['emp1'],
                passengerNames: ['황직원', '박외부'],
                passengerCount: 2,
            });

            expect(mockTransactionSet).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    passengerUids: ['emp1'],
                    passengerNames: ['황직원', '박외부'],
                    passengerCount: 2,
                })
            );
        });

        it('동승자가 없으면 필드를 만들지 않는다 (문서를 키우지 않는다)', async () => {
            mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1' }), docs: [] });

            await createReservationTx(validInput);

            const saved = mockTransactionSet.mock.calls[0][1];
            expect(saved).not.toHaveProperty('passengerUids');
            expect(saved).not.toHaveProperty('passengerNames');
            expect(saved).not.toHaveProperty('passengerCount');
        });

        it('상한(50명)을 넘는 명단은 거부한다 — 문서 크기·읽기 비용 방어', async () => {
            const tooMany = Array.from({ length: 51 }, (_, i) => `사람${i}`);

            await expect(
                createReservationTx({ ...validInput, passengerNames: tooMany })
            ).rejects.toThrow('최대 50명');
            expect(mockTransactionSet).not.toHaveBeenCalled();
        });

        it('인원 수가 음수·소수면 거부한다', async () => {
            await expect(
                createReservationTx({ ...validInput, passengerCount: -1 })
            ).rejects.toThrow('0 이상의 정수');
            await expect(
                createReservationTx({ ...validInput, passengerCount: 1.5 })
            ).rejects.toThrow('0 이상의 정수');
            expect(mockTransactionSet).not.toHaveBeenCalled();
        });
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
