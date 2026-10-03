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
const mockTransactionUpdate = jest.fn();
const mockTransaction = {
    get: mockTransactionGet,
    update: mockTransactionUpdate,
};
const mockRunTransaction = jest.fn(async (fn: (t: any) => Promise<any>) => fn(mockTransaction));
const mockDoc = jest.fn((id: string) => ({ id }));
const mockWhere = jest.fn().mockReturnThis();
const mockCollection = jest.fn((name: string) => ({ name, doc: (id: string) => ({ col: name, ...mockDoc(id) }), where: mockWhere }));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: mockCollection,
        runTransaction: mockRunTransaction,
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
        delete: jest.fn(() => '__delete__'),
    },
}));

jest.mock('../utils/vehicleStatus', () => ({
    isVehicleRetired: (retired: unknown) => retired === true,
    isVehicleBlockedOn: (maintenance: unknown) => Boolean(maintenance),
    seoulTodayStr: () => '2026-10-03',
}));

import { updateReservationTx } from "../services/reservation/updateReservationCore";

/** 승인된 직원 예약 */
const TARGET = {
    organizationId: 'org1', reservedByUid: 'emp1', status: 'reserved',
    vehicleId: 'v1', vehicleName: '스타렉스', date: '2026-10-10', startTime: '09:00', endTime: '10:00',
};

const EMP = { reservationId: 'r1', actorUid: 'emp1', actorOrgId: 'org1', actorRole: 'employee' };
const ADMIN = { reservationId: 'r1', actorUid: 'adm1', actorOrgId: 'org1', actorRole: 'admin' };

/**
 * get 순서: 예약 → (일정·차량·명의 변경 시) 차량 → [명의 변경 시 명의자] → 기관 → 차량 겹침 → 명의자 겹침
 */
function setup(opts: {
    reservation?: Record<string, unknown> | null;
    vehicle?: Record<string, unknown> | null;
    owner?: Record<string, unknown> | null;
    org?: Record<string, unknown>;
    existing?: Array<{ id: string; data: () => Record<string, unknown> }>;
    ownerExisting?: Array<{ id: string; data: () => Record<string, unknown> }>;
} = {}) {
    const snap = (v: Record<string, unknown> | null | undefined, fallback: Record<string, unknown>) =>
        v === null ? { exists: false, data: () => undefined } : { exists: true, data: () => v ?? fallback };

    // 문서 참조는 { col }, 쿼리는 where 체인이 돌려준 컬렉션 객체({ name })다.
    // 예약 쿼리 두 개는 순서로 구분한다(차량 겹침 → 명의자 겹침).
    let queryCall = 0;
    mockTransactionGet.mockImplementation(async (ref: any) => {
        switch (ref?.col) {
            case 'reservations': return snap(opts.reservation, TARGET);
            case 'vehicles': return snap(opts.vehicle, { organizationId: 'org1' });
            case 'users': return snap(opts.owner, { organizationId: 'org1' });
            case 'organizations': return snap(undefined, opts.org ?? {});
        }
        queryCall++;
        return { docs: queryCall === 1 ? (opts.existing ?? []) : (opts.ownerExisting ?? []) };
    });
}

/** 예약 문서에 쓴 값 */
function reservationWrite(): Record<string, unknown> | undefined {
    const call = mockTransactionUpdate.mock.calls.find(([ref]) => ref.col === 'reservations');
    return call?.[1];
}

describe('updateReservationTx (코어)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransactionGet.mockReset();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('권한', () => {
        it('타 기관 예약이면 거부한다 (조직 격리)', async () => {
            setup({ reservation: { ...TARGET, organizationId: 'org-OTHER' } });
            await expect(updateReservationTx({ ...EMP, destination: 'x' })).rejects.toThrow('자기 기관의 예약만');
            expect(mockTransactionUpdate).not.toHaveBeenCalled();
        });

        it('직원은 남의 예약을 수정할 수 없다', async () => {
            setup({ reservation: { ...TARGET, reservedByUid: 'other' } });
            await expect(updateReservationTx({ ...EMP, destination: 'x' })).rejects.toThrow('본인이 예약한');
        });

        it('관리자는 같은 기관 직원의 예약을 수정할 수 있다', async () => {
            setup();
            await expect(updateReservationTx({ ...ADMIN, destination: '복지관' })).resolves.toMatchObject({ status: 'reserved' });
            expect(reservationWrite()).toEqual({ destination: '복지관' });
        });

        it('직원은 명의를 바꿀 수 없다', async () => {
            setup();
            await expect(updateReservationTx({ ...EMP, reservedByUid: 'other' })).rejects.toThrow('기관 관리자만');
        });

        it('관리자도 타 기관 사람 명의로는 바꿀 수 없다', async () => {
            setup({ owner: { organizationId: 'org-OTHER' } });
            await expect(updateReservationTx({ ...ADMIN, reservedByUid: 'outsider' })).rejects.toThrow('같은 기관 구성원');
        });
    });

    describe('정보만 바꾸는 수정', () => {
        it('검증 없이 보낸 필드만 반영한다 (완료된 예약의 기록 정정 포함)', async () => {
            setup({ reservation: { ...TARGET, status: 'completed' } });
            const result = await updateReservationTx({ ...EMP, purpose: '업무', vehicleId: 'v1', startTime: '09:00' });
            expect(result).toEqual({ status: 'completed', requiresReapproval: false });
            expect(reservationWrite()).toEqual({ purpose: '업무' });
            // 차량을 읽지도 잠그지도 않는다
            expect(mockTransactionUpdate.mock.calls.some(([ref]) => ref.col === 'vehicles')).toBe(false);
        });
    });

    describe('일정·차량 변경 — 생성과 같은 검증', () => {
        it('승인제 기관에서 직원이 승인된 예약의 일정을 바꾸면 승인 대기로 되돌린다 (감사 발견 1)', async () => {
            setup({ org: { requireReservationApproval: true } });
            const result = await updateReservationTx({ ...EMP, date: '2026-12-24', startTime: '00:00', endTime: '23:59' });
            expect(result).toEqual({ status: 'pending', requiresReapproval: true });
            expect(reservationWrite()).toMatchObject({ date: '2026-12-24', startTime: '00:00', endTime: '23:59', status: 'pending' });
        });

        it('관리자는 승인권자라 일정을 바꿔도 승인 상태가 유지된다', async () => {
            setup({ org: { requireReservationApproval: true } });
            const result = await updateReservationTx({ ...ADMIN, startTime: '11:00', endTime: '12:00' });
            expect(result).toEqual({ status: 'reserved', requiresReapproval: false });
            expect(reservationWrite()).not.toHaveProperty('status');
        });

        it('승인제가 아니면 일정을 바꿔도 승인 상태가 유지된다', async () => {
            setup({ org: {} });
            await expect(updateReservationTx({ ...EMP, startTime: '11:00', endTime: '12:00' }))
                .resolves.toEqual({ status: 'reserved', requiresReapproval: false });
        });

        it('사용 제한 차량(allowedUserIds)으로 옮길 수 없다', async () => {
            setup({ vehicle: { organizationId: 'org1', allowedUserIds: ['someone_else'] } });
            await expect(updateReservationTx({ ...EMP, vehicleId: 'v_restricted' })).rejects.toThrow('지정된 직원만');
            expect(mockTransactionUpdate).not.toHaveBeenCalled();
        });

        it('정비 중인 차량으로 옮길 수 없다', async () => {
            setup({ vehicle: { organizationId: 'org1', maintenance: { startDate: '2026-10-01' } } });
            await expect(updateReservationTx({ ...EMP, vehicleId: 'v2' })).rejects.toThrow('정비 중');
        });

        it('같은 차량의 시간만 옮길 때는 정비 상태로 막지 않는다', async () => {
            setup({ vehicle: { organizationId: 'org1', maintenance: { startDate: '2026-10-01' } } });
            await expect(updateReservationTx({ ...EMP, startTime: '11:00', endTime: '12:00' })).resolves.toBeDefined();
        });

        it('타 기관 차량으로 옮길 수 없다', async () => {
            setup({ vehicle: { organizationId: 'org-OTHER' } });
            await expect(updateReservationTx({ ...EMP, vehicleId: 'v-other' })).rejects.toThrow('자기 기관의 차량만');
        });

        it('차량만 바꿔도 그 차량의 기존 예약과 겹치면 거부한다 (이중 예약 차단)', async () => {
            setup({
                existing: [{ id: 'r2', data: () => ({ status: 'reserved', startTime: '09:30', endTime: '11:00' }) }],
            });
            await expect(updateReservationTx({ ...EMP, vehicleId: 'v2' })).rejects.toThrow('이미 예약되어');
        });

        it('겹침 검사에서 자기 자신과 취소된 예약은 제외한다', async () => {
            setup({
                existing: [
                    { id: 'r1', data: () => ({ status: 'reserved', startTime: '09:00', endTime: '10:00' }) },
                    { id: 'r3', data: () => ({ status: 'cancelled', startTime: '09:00', endTime: '12:00' }) },
                ],
            });
            await expect(updateReservationTx({ ...EMP, startTime: '09:30', endTime: '11:00' })).resolves.toBeDefined();
        });

        it('명의자가 같은 시간에 다른 차량을 잡아 두었으면 거부한다', async () => {
            setup({
                ownerExisting: [{ id: 'r5', data: () => ({ status: 'reserved', startTime: '10:30', endTime: '12:00', vehicleName: '모닝' }) }],
            });
            await expect(updateReservationTx({ ...EMP, startTime: '10:00', endTime: '11:00' })).rejects.toThrow('한 대만');
        });

        it('취소·반려된 예약은 일정을 바꿀 수 없다', async () => {
            setup({ reservation: { ...TARGET, status: 'cancelled' } });
            await expect(updateReservationTx({ ...EMP, startTime: '11:00', endTime: '12:00' })).rejects.toThrow('일정을 바꿀 수 없습니다');
        });

        it('시간 형식·순서가 잘못되면 거부한다', async () => {
            setup();
            await expect(updateReservationTx({ ...EMP, date: '<script>' })).rejects.toThrow('형식');
            setup();
            await expect(updateReservationTx({ ...EMP, startTime: '12:00', endTime: '11:00' })).rejects.toThrow('빨라야');
        });

        it('차량 문서를 잠가 동시 생성·수정과 직렬화한다', async () => {
            setup();
            await updateReservationTx({ ...EMP, startTime: '11:00', endTime: '12:00' });
            expect(mockTransactionUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ col: 'vehicles' }),
                { _lastReservationLock: 'mock-timestamp' },
            );
        });
    });

    describe('반복 그룹에서 떼어내기', () => {
        it('recurringGroupId를 지우고 새 다일 그룹을 붙인다', async () => {
            setup();
            await updateReservationTx({ ...EMP, detachRecurring: true, groupId: 'grp_1', destination: 'x' });
            expect(reservationWrite()).toEqual({ destination: 'x', recurringGroupId: '__delete__', groupId: 'grp_1' });
        });

        it('떼어내지 않으면서 groupId만 바꿀 수는 없다', async () => {
            await expect(updateReservationTx({ ...EMP, groupId: 'grp_evil' })).rejects.toThrow('떼어낼 때만');
            expect(mockRunTransaction).not.toHaveBeenCalled();
        });
    });

    it('동승자 상한을 넘으면 거부한다', async () => {
        await expect(updateReservationTx({ ...EMP, passengerUids: Array.from({ length: 51 }, (_, i) => `u${i}`) }))
            .rejects.toThrow('최대 50명');
    });
});
