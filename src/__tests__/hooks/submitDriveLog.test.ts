import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * submitDriveLog — 운행일지 제출/수정 비즈니스 로직 통합 테스트.
 *
 * Firestore 호출(createDriveLog/updateDriveLog/updateReservationStatus/updateHipassCard)만
 * mock하고, 폼 → 저장 데이터 변환(buildLogData)은 실제 구현을 사용해 다음 핵심 분기를 검증한다.
 *   - 신규 제출: createDriveLog 호출 + 멱등성 ID + 폼 리셋
 *   - 예약 연계: 예약 completed 전환 + today 네비게이션
 *   - 수정 모드: updateDriveLog 호출 + my-records 네비게이션
 *   - 오프라인: offline 플래그 + 안내 메시지
 *   - 하이패스: 사용액만큼 잔액 차감
 *   - 부가 동기화 실패: 본 저장은 성공시키되 backgroundWarning 전파
 *   - 서버 트리거 km 자동 갱신(syncResult) 전파
 */

const mockCreateDriveLog = vi.fn();
const mockUpdateDriveLog = vi.fn();
const mockUpdateReservationStatus = vi.fn();
const mockUpdateHipassCard = vi.fn();

vi.mock('../../lib/firestore', () => ({
    createDriveLog: (...args: unknown[]) => mockCreateDriveLog(...args),
    updateDriveLog: (...args: unknown[]) => mockUpdateDriveLog(...args),
    updateReservationStatus: (...args: unknown[]) => mockUpdateReservationStatus(...args),
    updateHipassCard: (...args: unknown[]) => mockUpdateHipassCard(...args),
}));

vi.mock('../../lib/sentry', () => ({
    captureError: vi.fn(),
}));

// increment는 단순 sentinel로 치환해 호출 인자만 검증한다.
vi.mock('firebase/firestore', () => ({
    increment: (n: number) => ({ __increment: n }),
}));

import { submitDriveLog } from '../../hooks/driveLogForm/submitDriveLog';

type Ctx = Parameters<typeof submitDriveLog>[0];

const baseForm = {
    vehicleId: 'v1',
    vehicleName: '소나타',
    driverUid: '',
    driverName: '',
    purpose: '업무',
    destination: '서울역',
    startKm: '50000',
    endKm: '50050',
    startTime: '09:00',
    endTime: '10:00',
    batteryStart: '',
    batteryEnd: '',
    notes: '',
    driveDate: '2026-03-05',
    hipassBalanceAfter: '',
};

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
    return {
        form: { ...baseForm },
        orgId: 'org1',
        user: { uid: 'u1', displayName: '홍길동', email: 't@t.com' },
        userData: { name: '홍길동' },
        selectedVehicle: { vehicleType: 'sedan', currentKm: 50000 },
        selectedPassengers: [],
        externalPassengerCount: 0,
        externalPassengerNames: '',
        isRetroactive: false,
        ocrUsed: false,
        favoriteUsed: false,
        isElectric: false,
        isEditMode: false,
        editLog: null,
        reservationData: null,
        hipassCard: null,
        ...overrides,
    } as Ctx;
}

describe('submitDriveLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateDriveLog.mockResolvedValue({});
        mockUpdateDriveLog.mockResolvedValue({});
        mockUpdateReservationStatus.mockResolvedValue(undefined);
        mockUpdateHipassCard.mockResolvedValue(undefined);
        // 기본은 온라인 상태
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    });

    it('신규 제출 시 createDriveLog를 호출하고 멱등성 ID를 부여하며 폼 리셋을 요청한다', async () => {
        const result = await submitDriveLog(makeCtx());

        expect(mockCreateDriveLog).toHaveBeenCalledTimes(1);
        const payload = mockCreateDriveLog.mock.calls[0][0];
        // 멱등성 ID = vehicleId_uid_YYYYMMDD_startKm_endKm
        expect(payload.id).toBe('v1_u1_20260305_50000_50050');
        expect(payload.organizationId).toBe('org1');
        expect(payload.distance).toBe(50);
        expect(payload.reservationId).toBeNull();

        expect(result.success).toBe(true);
        expect(result.shouldResetForm).toBe(true);
        expect(result.offline).toBe(false);
        expect(mockUpdateDriveLog).not.toHaveBeenCalled();
    });

    it('예약 연계 제출 시 예약을 completed로 전환하고 today로 네비게이션한다', async () => {
        const result = await submitDriveLog(
            makeCtx({ reservationData: { reservationId: 'r1' } }),
        );

        expect(mockCreateDriveLog).toHaveBeenCalledTimes(1);
        expect(mockCreateDriveLog.mock.calls[0][0].reservationId).toBe('r1');
        expect(mockUpdateReservationStatus).toHaveBeenCalledWith(
            'r1',
            'completed',
            expect.objectContaining({ actualStartTime: '09:00', actualEndTime: '10:00' }),
        );
        expect(result.shouldNavigate).toBe('today');
        expect(result.success).toBe(true);
    });

    it('수정 모드에서는 updateDriveLog를 호출하고 my-records로 네비게이션한다', async () => {
        const editLog = { id: 'log1' } as Ctx['editLog'];
        const result = await submitDriveLog(makeCtx({ isEditMode: true, editLog }));

        expect(mockUpdateDriveLog).toHaveBeenCalledTimes(1);
        expect(mockUpdateDriveLog.mock.calls[0][0]).toBe('log1');
        expect(mockCreateDriveLog).not.toHaveBeenCalled();
        expect(result.shouldNavigate).toBe('my-records');
        expect(result.message).toContain('수정');
    });

    it('오프라인 상태에서는 offline 플래그와 안내 메시지를 반환한다', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

        const result = await submitDriveLog(makeCtx());

        // 오프라인이어도 createDriveLog는 호출(Firebase SDK가 로컬 큐잉)
        expect(mockCreateDriveLog).toHaveBeenCalledTimes(1);
        expect(result.offline).toBe(true);
        expect(result.message).toContain('오프라인');
    });

    it('하이패스 카드 사용 시 사용액만큼 잔액을 차감한다', async () => {
        const result = await submitDriveLog(
            makeCtx({
                form: { ...baseForm, hipassBalanceAfter: '9500' },
                hipassCard: { id: 'h1', cardNumber: '1234', balance: 10000 } as Ctx['hipassCard'],
            }),
        );

        expect(mockUpdateHipassCard).toHaveBeenCalledTimes(1);
        const [hipassId, update] = mockUpdateHipassCard.mock.calls[0];
        expect(hipassId).toBe('h1');
        // 10000 → 9500 사용액 500 차감
        expect(update.balance).toEqual({ __increment: -500 });
        expect(update.organizationId).toBe('org1');
        expect(result.success).toBe(true);
    });

    it('예약 상태 전환이 실패해도 본 저장은 성공시키되 backgroundWarning을 전파한다', async () => {
        mockUpdateReservationStatus.mockRejectedValueOnce(new Error('network'));

        const result = await submitDriveLog(
            makeCtx({ reservationData: { reservationId: 'r1' } }),
        );

        expect(result.success).toBe(true);
        expect(result.backgroundWarning).toBeTruthy();
        expect(result.backgroundWarning).toContain('예약 상태');
    });

    it('서버 트리거가 다음 기록 km를 자동 갱신하면 syncResult를 전파한다', async () => {
        mockCreateDriveLog.mockResolvedValueOnce({
            syncResult: { updated: true, oldStartKm: 100, newStartKm: 200 },
        });

        const result = await submitDriveLog(makeCtx());

        expect(result.syncResult).toEqual({ updated: true, oldStartKm: 100, newStartKm: 200 });
    });
});
