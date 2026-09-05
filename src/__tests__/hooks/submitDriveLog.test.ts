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
const mockCompleteGroup = vi.fn();

vi.mock('../../lib/firestore', () => ({
    createDriveLog: (...args: unknown[]) => mockCreateDriveLog(...args),
    updateDriveLog: (...args: unknown[]) => mockUpdateDriveLog(...args),
    updateReservationStatus: (...args: unknown[]) => mockUpdateReservationStatus(...args),
    updateHipassCard: (...args: unknown[]) => mockUpdateHipassCard(...args),
    completeReservationGroupSiblings: (...args: unknown[]) => mockCompleteGroup(...args),
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
    endDate: '',
    needsRefuel: false,
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
        mockCompleteGroup.mockResolvedValue(0);
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

    it('수정 모드에서는 하이패스 사용후 금액이 입력돼도 잔액을 차감하지 않는다', async () => {
        // 과거 일지를 수정할 때 hipassCard.balance는 '그 일지를 쓰던 시점'이 아니라 '오늘'의
        // 잔액이다. 이를 기준(before)으로 사용액을 계산하면 카드 잔액이 엉뚱한 값이 된다 —
        // 아래 값(오늘 7,000 / 그날 기록 9,500)이면 차감은커녕 2,500원이 늘어난다.
        // 그래서 잔액 반영은 신규 제출에서만 하고, 수정 화면에는 입력칸 자체를 띄우지 않는다.
        const editLog = { id: 'log1' } as Ctx['editLog'];
        const result = await submitDriveLog(
            makeCtx({
                isEditMode: true,
                editLog,
                form: { ...baseForm, hipassBalanceAfter: '9500' },
                hipassCard: { id: 'h1', cardNumber: '1234', balance: 7000 } as Ctx['hipassCard'],
            }),
        );

        expect(mockUpdateHipassCard).not.toHaveBeenCalled();

        // 그 일지에 이미 남아 있는 하이패스 기록도 오늘 잔액으로 덮어쓰지 않는다.
        // (updateDriveLog는 updateDoc이라 전달하지 않은 필드는 그대로 보존된다)
        const payload = mockUpdateDriveLog.mock.calls[0][1];
        expect(payload).not.toHaveProperty('hipassBalanceBefore');
        expect(payload).not.toHaveProperty('hipassBalanceAfter');
        expect(result.success).toBe(true);
    });

    it('소급 입력(오늘이 아닌 날짜의 신규 일지)에서도 하이패스 잔액을 차감하지 않는다', async () => {
        // 누락 운행 소급 입력은 '새 일지를 쓰는' 경로라 isEditMode가 false다.
        // 수정 모드만 막으면 오늘 잔액을 기준 삼는 같은 계산이 여기 그대로 남는다.
        const result = await submitDriveLog(
            makeCtx({
                isRetroactive: true,
                form: { ...baseForm, hipassBalanceAfter: '9500' },
                hipassCard: { id: 'h1', cardNumber: '1234', balance: 7000 } as Ctx['hipassCard'],
            }),
        );

        expect(mockUpdateHipassCard).not.toHaveBeenCalled();

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload).not.toHaveProperty('hipassBalanceBefore');
        expect(payload).not.toHaveProperty('hipassBalanceAfter');
        expect(result.success).toBe(true);
    });

    it('주유 필요를 표시하면 저장 데이터에 needsRefuel을 남긴다', async () => {
        await submitDriveLog(makeCtx({ form: { ...baseForm, needsRefuel: true } }));

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload.needsRefuel).toBe(true);
    });

    it('주유 필요를 표시하지 않으면 needsRefuel 필드를 아예 남기지 않는다', async () => {
        // false를 매번 쓰면 모든 운행일지에 의미 없는 필드가 붙는다.
        // 서버 트리거는 값의 존재만 보므로 undefined로 떨구는 편이 맞다.
        await submitDriveLog(makeCtx());

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload.needsRefuel).toBeUndefined();
    });

    it('지난 날짜 일지에는 주유 필요를 남기지 않는다', async () => {
        // 토글을 켠 뒤 날짜를 과거로 바꾸면 UI는 사라지지만 폼 값은 true로 남는다.
        // 차량 상태는 서버 가드가 막지만, 그대로 저장하면 기록 자체가 사실과 달라진다.
        await submitDriveLog(makeCtx({
            isRetroactive: true,
            form: { ...baseForm, needsRefuel: true },
        }));

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload.needsRefuel).toBeUndefined();
    });

    it('이틀 이상 걸린 운행은 출발일을 남기고 timestamp는 도착일로 찍는다', async () => {
        // timestamp는 도착 시각 기준(바뀌지 않았다). 출발일만 따로 남긴다 —
        // 도착일을 또 저장하면 timestamp와 중복되고 둘이 어긋날 수 있다.
        await submitDriveLog(makeCtx({
            form: { ...baseForm, driveDate: '2026-03-05', endDate: '2026-03-06', startTime: '17:00', endTime: '10:00' },
        }));

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload.startDate).toBe('2026-03-05');
        const ts = payload.timestamp as Date;
        expect(ts.getDate()).toBe(6);   // 도착일
        expect(ts.getHours()).toBe(10); // 도착 시각
    });

    it('같은 날 운행에는 출발일 필드를 만들지 않는다 — 기존 문서와 모양이 같아야 한다', async () => {
        await submitDriveLog(makeCtx({ form: { ...baseForm, endDate: '2026-03-05' } }));

        const payload = mockCreateDriveLog.mock.calls[0][0];
        expect(payload.startDate).toBeUndefined();
    });

    it('예약 연계 제출은 다일 예약의 나머지 날짜도 함께 닫는다', async () => {
        // 1박2일 예약은 문서 두 건이다. 운행은 한 번인데 한 건만 닫으면 남은 날짜가
        // 미완료로 떠 운행일지 미작성 알림이 계속 울린다.
        mockCompleteGroup.mockResolvedValueOnce(1);

        const result = await submitDriveLog(makeCtx({ reservationData: { reservationId: 'r1' } }));

        expect(mockCompleteGroup).toHaveBeenCalledWith('r1', 'org1');
        expect(result.success).toBe(true);
    });

    it('그룹 닫기가 실패해도 본 저장은 성공시키되 경고를 남긴다', async () => {
        mockCompleteGroup.mockRejectedValueOnce(new Error('permission-denied'));

        const result = await submitDriveLog(makeCtx({ reservationData: { reservationId: 'r1' } }));

        expect(result.success).toBe(true);
        expect(result.backgroundWarning).toBeTruthy();
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
