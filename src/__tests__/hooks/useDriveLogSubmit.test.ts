/**
 * useDriveLogSubmit — 운행일지 폼의 제출 흐름
 *
 * `submitDriveLog`(저장 데이터 변환)는 별도 테스트가 있으므로 여기서는 **그 앞뒤의 판단**을 고정한다.
 *  - 검증 실패 시 저장하지 않고 안내만 한다
 *  - 수정 모드의 km 범위 오류는 토스트가 아니라 모달 상태로 남긴다(사용자가 고칠 때까지)
 *  - 출발 km 확인 요구(REQUIRES_START_KM_CONFIRMATION)는 재시도를 멈추고 확인 모달을 띄운다
 *  - 중복·타임아웃은 **성공으로 처리한다** — 이미 저장됐거나 오프라인 큐에 들어간 것이라
 *    실패로 알리면 사용자가 같은 일지를 한 번 더 쓴다
 *  - 저장 뒤 이동 경로(예약 연계 → 오늘의 운행, 수정 → 내 기록, 그 외 → 폼 초기화)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

const mockSubmitDriveLog = vi.fn();
vi.mock('../../hooks/driveLogForm/submitDriveLog', async () => {
    const actual = await vi.importActual<typeof import('../../hooks/driveLogForm/submitDriveLog')>(
        '../../hooks/driveLogForm/submitDriveLog',
    );
    return { ...actual, submitDriveLog: (...a: unknown[]) => mockSubmitDriveLog(...a) };
});

const mockAdjustAdjacentLogs = vi.fn(async () => [] as string[]);
vi.mock('../../hooks/driveLogForm/adjustAdjacentLogs', () => ({
    adjustAdjacentLogs: (...a: unknown[]) => mockAdjustAdjacentLogs(...(a as [])),
}));

vi.mock('../../lib/firestore', () => ({
    createFavorite: vi.fn(),
    getFavorites: vi.fn(async () => []),
    getLastVehicleDriveLog: vi.fn(async () => null),
}));
vi.mock('../../hooks/driveLogForm/resolveStartKm', () => ({
    resolveStartKm: vi.fn(async () => '51000'),
}));
vi.mock('../../hooks/useTodayDashboard', () => ({ invalidateDashboardCache: vi.fn() }));
const mockDurable = vi.fn(() => true);
vi.mock('../../lib/firebase', () => ({ hasDurableLocalCache: () => mockDurable() }));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

import { useDriveLogSubmit, type SubmitDeps } from '../../hooks/driveLogForm/useDriveLogSubmit';
import { getEmptyForm } from '../../hooks/driveLogForm/submitDriveLog';
import type { DriveLogForm } from '../../hooks/driveLogForm/types';
import type { DriveLog } from '../../types/driveLog';
import type { User as UserDoc } from '../../types/user';

/** 검증을 통과하는 최소 폼 */
function validForm(over: Partial<DriveLogForm> = {}): DriveLogForm {
    return {
        ...getEmptyForm(),
        vehicleId: 'v1',
        vehicleName: '카니발',
        driverUid: 'u1',
        driverName: '홍길동',
        purpose: '출장',
        destination: '시청',
        startTime: '09:00',
        endTime: '11:00',
        startKm: '51000',
        endKm: '51050',
        driveDate: '2026-03-05',
        ...over,
    };
}

const showToast = vi.fn();
const setForm = vi.fn();
const setSuccess = vi.fn();
const setSelectedPassengers = vi.fn();
const setSelectedCoDrivers = vi.fn();
const setExternalPassengerCount = vi.fn();
const setExternalCoDriverNames = vi.fn();

/** runWithRetry는 실제 재시도 대신 onError 계약만 재현한다 */
const runWithRetry = vi.fn(async (
    _key: string,
    fn: () => Promise<unknown>,
    opts?: { onError?: (err: unknown) => boolean | void },
) => {
    try {
        return await fn();
    } catch (err) {
        if (opts?.onError?.(err)) return undefined; // true = 처리 완료, 재시도 중단
        throw err;
    }
});

function deps(over: Partial<SubmitDeps> = {}): SubmitDeps {
    return {
        form: validForm(),
        setForm,
        orgId: 'org1',
        user: { uid: 'u1', displayName: '홍길동', email: 'a@b.c' } as SubmitDeps['user'],
        userData: { id: 'u1', name: '홍길동' } as UserDoc,
        vehicles: [],
        selectedVehicle: { id: 'v1', currentKm: 51000 } as SubmitDeps['selectedVehicle'],
        selectedPassengers: [],
        setSelectedPassengers,
        externalPassengerCount: 0,
        setExternalPassengerCount,
        externalPassengerNames: '',
        selectedCoDrivers: [],
        setSelectedCoDrivers,
        externalCoDriverNames: '',
        setExternalCoDriverNames,
        setFavorites: vi.fn(),
        setShowFavSave: vi.fn(),
        setFavName: vi.fn(),
        setSuccess,
        isElectric: false,
        isRetroactive: false,
        isEditMode: false,
        editLog: null,
        reservationData: null,
        hipassCard: null,
        favName: '',
        lastDriveLog: null,
        nextDriveLog: null,
        setLastDriveLog: vi.fn(),
        showToast,
        runWithRetry: runWithRetry as unknown as SubmitDeps['runWithRetry'],
        // startTransition은 즉시 실행해 테스트가 동기적으로 결과를 볼 수 있게 한다
        startTransition: (scope: () => Promise<void>) => { void scope(); },
        ocrSuccess: false,
        ...over,
    };
}

async function submit(d: SubmitDeps) {
    const { result } = renderHook(() => useDriveLogSubmit(d));
    await act(async () => {
        await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });
    return result;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitDriveLog.mockResolvedValue({ shouldResetForm: true });
    mockAdjustAdjacentLogs.mockResolvedValue([]);
});

describe('입력 검증', () => {
    it('검증에 걸리면 저장을 시도하지 않고 안내만 한다', async () => {
        await submit(deps({ form: validForm({ vehicleId: '' }) }));
        expect(mockSubmitDriveLog).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
    });

    it('같은 날인데 도착이 출발보다 이르면 저장을 막는다', async () => {
        // 검증 자체는 driveWindow.test.ts가 다룬다. 여기서는 그 검증이 제출 경로에 실제로
        // **꽂혀 있는지**를 고정한다 — 함수만 있고 호출되지 않으면 아무 소용이 없다.
        await submit(deps({ form: validForm({ startTime: '17:00', endTime: '10:00', endDate: '' }) }));

        expect(mockSubmitDriveLog).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('도착 시각'), 'warning');
    });

    it('다음 날 도착이면 도착 시각이 일러도 저장한다', async () => {
        await submit(deps({
            form: validForm({ startTime: '17:00', endTime: '10:00', driveDate: '2026-03-05', endDate: '2026-03-06' }),
        }));

        expect(mockSubmitDriveLog).toHaveBeenCalled();
    });

    it('수정 모드에서 직전·직후 기록의 범위를 벗어나면 저장하지 않고 모달 상태로 남긴다', async () => {
        const result = await submit(deps({
            isEditMode: true,
            editLog: { id: 'e1' } as DriveLog,
            // 직전 기록이 52,000에서 출발했으므로 51,000으로 되돌리는 수정은 범위를 벗어난다
            lastDriveLog: { id: 'prev', startKm: 52000, endKm: 52500 } as DriveLog,
            nextDriveLog: null,
        }));

        expect(mockSubmitDriveLog).not.toHaveBeenCalled();
        expect(result.current.kmRangeError).toBeTruthy();
    });

    it('범위 오류는 사용자가 닫을 때까지 남는다', async () => {
        const result = await submit(deps({
            isEditMode: true,
            editLog: { id: 'e1' } as DriveLog,
            lastDriveLog: { id: 'prev', startKm: 52000, endKm: 52500 } as DriveLog,
        }));

        act(() => result.current.handleDismissKmRangeError());
        expect(result.current.kmRangeError).toBeNull();
    });
});

describe('출발 km 수동 보정 표시', () => {
    it('직전 기록의 도착 km와 다르면 보정으로 표시하고 원래 값을 함께 넘긴다', async () => {
        await submit(deps({
            form: validForm({ startKm: '51200', endKm: '51300' }),
            lastDriveLog: { id: 'prev', endKm: 51000 } as DriveLog,
        }));

        expect(mockSubmitDriveLog).toHaveBeenCalledWith(expect.objectContaining({
            isManuallyCorrected: true,
            originalStartKm: 51000,
        }));
    });

    it('직전 기록이 없으면 차량의 누적 km를 기준으로 본다', async () => {
        await submit(deps({ form: validForm({ startKm: '51000' }) }));
        expect(mockSubmitDriveLog).toHaveBeenCalledWith(expect.objectContaining({
            isManuallyCorrected: false,
            originalStartKm: undefined,
        }));
    });
});

describe('출발 km 확인 요구', () => {
    it('확인이 필요하면 재시도를 멈추고 확인 모달 값을 채운다', async () => {
        mockSubmitDriveLog.mockRejectedValue(
            Object.assign(new Error('confirm'), {
                code: 'REQUIRES_START_KM_CONFIRMATION', originalStartKm: 51000, suggestedStartKm: 51500,
            }),
        );

        const result = await submit(deps());
        expect(result.current.confirmStartKm).toEqual({ original: 51000, suggested: 51500 });
        expect(setSuccess).not.toHaveBeenCalledWith(true);
    });

    it('확인하면 제안값으로 폼을 고친다', async () => {
        mockSubmitDriveLog.mockRejectedValue(
            Object.assign(new Error('confirm'), { code: 'REQUIRES_START_KM_CONFIRMATION', suggestedStartKm: 51500 }),
        );
        const result = await submit(deps());

        act(() => result.current.handleConfirmStartKm());
        expect(setForm).toHaveBeenCalled();
        expect(result.current.confirmStartKm).toBeNull();
    });

    it('취소하면 모달만 닫는다', async () => {
        mockSubmitDriveLog.mockRejectedValue(
            Object.assign(new Error('confirm'), { code: 'REQUIRES_START_KM_CONFIRMATION' }),
        );
        const result = await submit(deps());

        act(() => result.current.handleCancelConfirm());
        expect(result.current.confirmStartKm).toBeNull();
    });
});

describe('중복·타임아웃은 성공으로 처리한다', () => {
    it('중복이면 이미 저장된 것으로 알린다 — 실패로 알리면 같은 일지를 두 번 쓴다', async () => {
        mockSubmitDriveLog.mockRejectedValue(new Error('중복 요청'));
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('이미 목록에 저장'), 'success');
        expect(setSuccess).toHaveBeenCalledWith(true);
    });

    it('타임아웃이면 로컬 임시 저장으로 안내한다', async () => {
        mockDurable.mockReturnValue(true);
        mockSubmitDriveLog.mockRejectedValue(new Error('TIMEOUT'));
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('로컬에 임시 저장'), 'success');
    });

    it('임시 보관이 안 되는 기기에서는 저장했다고 말하지 않는다', async () => {
        // 타임아웃은 실패가 아니라 **모름**이다. persistent 캐시면 Firestore가 미전송 쓰기를
        // 남겨 두므로 사실상 저장된 것이 맞지만, memory 캐시로 떨어진 기기(사생활 보호 모드 등)는
        // 탭을 닫는 순간 사라진다. 그때도 초록색으로 "저장했습니다"라고 하면 거짓말이 된다.
        mockDurable.mockReturnValue(false);
        mockSubmitDriveLog.mockRejectedValue(new Error('TIMEOUT'));

        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('확인하지 못했습니다'), 'warning');
        expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('임시 저장했습니다'), 'success');
    });

    it('예약에서 넘어온 작성이면 오늘의 운행으로 돌려보낸다', async () => {
        mockSubmitDriveLog.mockRejectedValue(new Error('중복 요청'));
        await submit(deps({ reservationData: { reservationId: 'r1' } }));

        expect(mockNavigate).toHaveBeenCalledWith('/employee/today', { replace: true });
    });

    it('수정 중이었다면 내 기록으로 돌려보낸다', async () => {
        mockSubmitDriveLog.mockRejectedValue(new Error('중복 요청'));
        await submit(deps({ isEditMode: true, editLog: { id: 'e1' } as DriveLog }));

        expect(mockNavigate).toHaveBeenCalledWith('/employee/my-records', { replace: true });
    });

    it('그 외에는 이동하지 않고 폼만 비운다', async () => {
        mockSubmitDriveLog.mockRejectedValue(new Error('중복 요청'));
        await submit(deps());

        expect(mockNavigate).not.toHaveBeenCalled();
        expect(setForm).toHaveBeenCalled();
    });

    it('알 수 없는 오류는 성공으로 처리하지 않는다', async () => {
        mockSubmitDriveLog.mockRejectedValue(new Error('서버가 폭발했습니다'));
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith('알 수 없는 오류가 발생했습니다.', 'error');
        expect(setSuccess).not.toHaveBeenCalledWith(true);
    });
});

describe('저장 후 처리', () => {
    it('오프라인 저장이면 안내만 하고 이동하지 않는다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ offline: true, message: '오프라인 저장됨', shouldResetForm: true });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith('오프라인 저장됨', 'info');
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('수정 완료면 내 기록으로 이동한다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ shouldNavigate: 'my-records', message: '수정됨' });
        await submit(deps());

        expect(mockNavigate).toHaveBeenCalledWith('/employee/my-records', { replace: true });
    });

    it('예약 운행 완료면 오늘의 운행으로 이동한다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ shouldNavigate: 'today' });
        await submit(deps());

        expect(mockNavigate).toHaveBeenCalledWith('/employee/today', { replace: true });
    });

    it('서버가 다음 기록의 출발 km를 갱신했으면 알린다', async () => {
        mockSubmitDriveLog.mockResolvedValue({
            shouldResetForm: true,
            syncResult: { updated: true, oldStartKm: 51000, newStartKm: 51050 },
        });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('자동 갱신'), 'info');
    });

    it('동시 작성으로 출발 km가 보정됐으면 알린다', async () => {
        mockSubmitDriveLog.mockResolvedValue({
            shouldResetForm: true,
            correctedKm: { oldStartKm: 51000, correctedStartKm: 51100 },
        });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('동시 작성 감지'), 'info');
    });

    it('타지 않은 날 예약이 취소됐으면 그 자리에서 알린다', async () => {
        // 사용자가 요청하지 않은 변경이다. 조용히 넘어가면 [운행 종료]를 잘못 누른 사람이
        // 예약이 사라진 것을 모른 채 다음 날 차를 찾으러 간다.
        mockSubmitDriveLog.mockResolvedValue({ shouldResetForm: true, cancelledReservationDays: 2 });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('나머지 2일 예약을 함께 취소'), 'info');
    });

    it('취소된 날이 없으면 알리지 않는다', async () => {
        // 단건 예약과 정상 다일 운행이 대다수다 — 여기에 토스트가 뜨면 헛알림이 된다.
        mockSubmitDriveLog.mockResolvedValue({ shouldResetForm: true, cancelledReservationDays: 0 });
        await submit(deps());

        expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('취소'), 'info');
    });

    it('오프라인 저장이어도 취소가 있었다면 알린다 — 조기 반환보다 앞에 둔다', async () => {
        // 오프라인 분기는 안내만 하고 곧바로 return한다. 토스트가 그 아래로 내려가면
        // 취소는 실제로 일어났는데 화면에는 아무 말도 남지 않는다.
        mockSubmitDriveLog.mockResolvedValue({
            offline: true, message: '오프라인 저장됨', shouldResetForm: true, cancelledReservationDays: 1,
        });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('나머지 1일 예약을 함께 취소'), 'info');
    });

    it('부가 동기화가 실패했으면 경고로 전달한다 — 본 저장은 성공이다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ shouldResetForm: true, backgroundWarning: '캘린더 반영 실패' });
        await submit(deps());

        expect(showToast).toHaveBeenCalledWith('캘린더 반영 실패', 'warning');
        expect(setSuccess).toHaveBeenCalledWith(true);
    });

    it('수정 모드에서 인접 기록이 조정되면 무엇이 바뀌었는지 알린다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ shouldNavigate: 'my-records' });
        mockAdjustAdjacentLogs.mockResolvedValue(['직전 도착 51,000']);
        await submit(deps({ isEditMode: true, editLog: { id: 'e1' } as DriveLog }));

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('인접 기록이 자동 조정'), 'info');
    });

    it('조정할 인접 기록이 없으면 알리지 않는다', async () => {
        mockSubmitDriveLog.mockResolvedValue({ shouldNavigate: 'my-records' });
        await submit(deps({ isEditMode: true, editLog: { id: 'e1' } as DriveLog }));

        expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('인접 기록이 자동 조정'), 'info');
    });
});

describe('동승자·공동 운전자 토글', () => {
    const member = { id: 'm1', name: '김철수' } as UserDoc;

    it('없으면 추가하고 있으면 뺀다', () => {
        const { result } = renderHook(() => useDriveLogSubmit(deps()));

        act(() => result.current.togglePassenger(member));
        const passengerUpdater = setSelectedPassengers.mock.calls[0][0] as (p: UserDoc[]) => UserDoc[];
        expect(passengerUpdater([])).toEqual([member]);
        expect(passengerUpdater([member])).toEqual([]);

        act(() => result.current.toggleCoDriver(member));
        const coDriverUpdater = setSelectedCoDrivers.mock.calls[0][0] as (p: UserDoc[]) => UserDoc[];
        expect(coDriverUpdater([])).toEqual([member]);
        expect(coDriverUpdater([member])).toEqual([]);
    });
});

describe('대표 운전자 선택', () => {
    it('uid와 이름을 함께 폼에 반영한다 — 이름만 바뀌면 통계가 다른 사람에게 붙는다', () => {
        const { result } = renderHook(() => useDriveLogSubmit(deps()));

        act(() => result.current.handleSelectDriver('u2', '김철수'));
        const updater = setForm.mock.calls[0][0] as (p: DriveLogForm) => DriveLogForm;
        expect(updater(validForm())).toMatchObject({ driverUid: 'u2', driverName: '김철수' });
    });
});
