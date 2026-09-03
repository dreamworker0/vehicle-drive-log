/**
 * useVehicleManager — 차량 관리 화면의 폼·모달 동작
 *
 * 기존 useVehicleManager.test.ts는 초기 로딩만 덮고 있었다. 여기서는 관리자가 실제로
 * 누르는 흐름을 고정한다:
 *  - 모델명을 치면 차종·연료가 자동으로 따라온다(전기·수소는 고정)
 *  - 저장 페이로드: 보험 정보 묶음, 캘린더 ID를 바꾸면 실패 카운터 초기화
 *  - 삭제: **운행일지가 있는 차량은 막는다**(기록이 지워지면 복구 경로가 없다)
 *  - 폐차: 폐차와 동시에 오늘 이후 예약을 취소한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

/** 실제 재시도 대신 onError 계약만 재현한다 */
vi.mock('../../hooks/useRetry', () => ({
    default: () => ({
        runWithRetry: async (
            _key: string,
            fn: () => Promise<unknown>,
            opts?: { onError?: (err: unknown) => boolean | void },
        ) => {
            try {
                return await fn();
            } catch (err) {
                if (opts?.onError?.(err)) return undefined;
                throw err;
            }
        },
    }),
}));

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'admin1' },
        userData: { organizationId: 'org1', name: '관리자', role: 'admin' },
    }),
}));

const mockGetVehicles = vi.fn();
const mockCreateVehicle = vi.fn();
const mockUpdateVehicle = vi.fn();
const mockDeleteVehicle = vi.fn();
const mockClearMaintenance = vi.fn();
const mockRetireVehicle = vi.fn();
const mockRestoreVehicle = vi.fn();
const mockCancelReservations = vi.fn();
const mockHasVehicleDriveLogs = vi.fn();
const mockGetOrganizationMembers = vi.fn();

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    createVehicle: (...a: unknown[]) => mockCreateVehicle(...a),
    updateVehicle: (...a: unknown[]) => mockUpdateVehicle(...a),
    deleteVehicle: (...a: unknown[]) => mockDeleteVehicle(...a),
    clearVehicleMaintenanceBlock: (...a: unknown[]) => mockClearMaintenance(...a),
    retireVehicle: (...a: unknown[]) => mockRetireVehicle(...a),
    restoreVehicle: (...a: unknown[]) => mockRestoreVehicle(...a),
    cancelVehicleReservations: (...a: unknown[]) => mockCancelReservations(...a),
    hasVehicleDriveLogs: (...a: unknown[]) => mockHasVehicleDriveLogs(...a),
    getOrganizationMembers: (...a: unknown[]) => mockGetOrganizationMembers(...a),
}));

vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

import useVehicleManager from '../../hooks/useVehicleManager';
import type { Vehicle } from '../../types/vehicle';

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
    return {
        id: 'v1', organizationId: 'org1', name: '카니발', displayName: '카니발',
        modelName: '카니발', plateNumber: '12가3456', currentKm: 50000, vehicleType: 'van',
        ...over,
    } as Vehicle;
}

/** 로딩이 끝난 훅을 돌려준다 */
async function setup() {
    const hook = renderHook(() => useVehicleManager());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetVehicles.mockResolvedValue([vehicle()]);
    mockHasVehicleDriveLogs.mockResolvedValue(false);
    mockGetOrganizationMembers.mockResolvedValue([]);
    mockCreateVehicle.mockResolvedValue('v9');
    mockUpdateVehicle.mockResolvedValue(undefined);
    mockDeleteVehicle.mockResolvedValue(undefined);
    mockRetireVehicle.mockResolvedValue(undefined);
    mockRestoreVehicle.mockResolvedValue(undefined);
    mockClearMaintenance.mockResolvedValue(undefined);
    mockCancelReservations.mockResolvedValue(undefined);
});

describe('직원 목록', () => {
    it('superAdmin과 비활성 계정은 사용 가능 직원 후보에서 뺀다', async () => {
        mockGetOrganizationMembers.mockResolvedValue([
            { id: 'a', role: 'employee' },
            { id: 'b', role: 'superAdmin' },
            { id: 'c', role: 'employee', status: 'disabled' },
        ]);
        const { result } = await setup();

        await waitFor(() => expect(result.current.members).toHaveLength(1));
        expect(result.current.members[0].id).toBe('a');
    });
});

describe('삭제 가능 여부', () => {
    it('운행일지가 있는 차량은 삭제 가능 목록에서 뺀다', async () => {
        mockGetVehicles.mockResolvedValue([vehicle({ id: 'v1' }), vehicle({ id: 'v2' })]);
        mockHasVehicleDriveLogs.mockImplementation(async (_org: string, id: string) => id === 'v1');

        const { result } = await setup();
        expect(result.current.deletableIds.has('v1')).toBe(false);
        expect(result.current.deletableIds.has('v2')).toBe(true);
    });
});

describe('모델명 자동 인식', () => {
    it('전기차 모델이면 연료를 전기로 고정한다', async () => {
        const { result } = await setup();
        act(() => result.current.handleModelNameChange('아이오닉5'));
        expect(result.current.form.fuelType).toBe('electric');
    });

    it('수소차 모델이면 수소로 고정한다', async () => {
        const { result } = await setup();
        act(() => result.current.handleModelNameChange('넥쏘'));
        expect(result.current.form.fuelType).toBe('hydrogen');
    });

    it('전기차에서 내연기관 모델로 고쳐 쓰면 연료도 함께 되돌아온다', async () => {
        const { result } = await setup();
        act(() => result.current.handleModelNameChange('아이오닉5'));
        expect(result.current.form.fuelType).toBe('electric');

        act(() => result.current.handleModelNameChange('소나타'));
        expect(result.current.form.fuelType).not.toBe('electric');
    });

    it('알 수 없는 모델명이면 차종을 건드리지 않는다', async () => {
        const { result } = await setup();
        const before = result.current.form.vehicleType;
        act(() => result.current.handleModelNameChange('알수없는모델XYZ'));
        expect(result.current.form.vehicleType).toBe(before);
        expect(result.current.form.modelName).toBe('알수없는모델XYZ');
    });
});

describe('수정 시작 / 폼 초기화', () => {
    it('수정 버튼을 누르면 기존 값이 폼에 채워지고 폼이 열린다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle({
            displayName: '스타렉스', insurance: { company: 'DB', phone: '1588', expiryDate: '2026-12-31' },
            allowedUserIds: ['u1'],
        })));

        expect(result.current.showForm).toBe(true);
        expect(result.current.form).toMatchObject({
            displayName: '스타렉스', insuranceCompany: 'DB', insurancePhone: '1588',
            insuranceExpiryDate: '2026-12-31', allowedUserIds: ['u1'],
        });
    });

    it('캘린더 오류로 열면 그 상태를 알린다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle(), true));
        expect(result.current.openWithCalendarError).toBe(true);
    });

    it('초기화하면 폼을 닫고 수정 대상도 지운다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle()));
        act(() => result.current.resetForm());

        expect(result.current.showForm).toBe(false);
        expect(result.current.editingVehicle).toBeNull();
        expect(result.current.openWithCalendarError).toBe(false);
    });
});

describe('저장', () => {
    const submit = (result: { current: ReturnType<typeof useVehicleManager> }) =>
        act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
        });

    async function fillForm(result: { current: ReturnType<typeof useVehicleManager> }, over: Record<string, unknown> = {}) {
        act(() => result.current.setForm(prev => ({
            ...prev,
            displayName: '새 차량', modelName: '소나타', plateNumber: '99가9999', currentKm: '1000',
            ...over,
        })));
    }

    it('필수 항목이 비면 저장하지 않는다', async () => {
        const { result } = await setup();
        await submit(result);
        expect(mockCreateVehicle).not.toHaveBeenCalled();
    });

    it('누적 km가 음수면 안내하고 저장하지 않는다 — 계기판은 절대값이다', async () => {
        const { result } = await setup();
        await fillForm(result, { currentKm: '-1' });
        await submit(result);

        expect(mockShowToast).toHaveBeenCalledWith('현재 누적 km는 0 이상이어야 합니다.', 'warning');
        expect(mockCreateVehicle).not.toHaveBeenCalled();
    });

    it('새 차량은 보험 정보를 한 덩어리로 묶어 저장한다', async () => {
        const { result } = await setup();
        await fillForm(result, { insuranceCompany: 'DB', insurancePhone: '1588', insuranceExpiryDate: '2026-12-31' });
        await submit(result);

        expect(mockCreateVehicle).toHaveBeenCalledWith(expect.objectContaining({
            displayName: '새 차량',
            currentKm: 1000,
            organizationId: 'org1',
            insurance: { company: 'DB', phone: '1588', expiryDate: '2026-12-31' },
        }));
    });

    it('만료일을 비우면 보험에 만료일 키를 넣지 않는다', async () => {
        const { result } = await setup();
        await fillForm(result, { insuranceCompany: 'DB' });
        await submit(result);

        expect(mockCreateVehicle.mock.calls[0][0].insurance).toEqual({ company: 'DB', phone: '' });
    });

    it('사용 가능 직원을 모두 해제하면 빈 배열로 저장한다 — 키를 빼면 제한이 남는다', async () => {
        const { result } = await setup();
        await fillForm(result, { allowedUserIds: [] });
        await submit(result);

        expect(mockCreateVehicle.mock.calls[0][0].allowedUserIds).toEqual([]);
    });

    it('수정이면 update를 부른다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle({ id: 'v7' })));
        await fillForm(result);
        await submit(result);

        expect(mockUpdateVehicle).toHaveBeenCalledWith('v7', expect.any(Object));
        expect(mockCreateVehicle).not.toHaveBeenCalled();
    });

    it('캘린더 ID를 바꾸면 동기화 실패 카운터를 0으로 되돌린다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle({ id: 'v7', googleCalendarId: 'old@group' })));
        await fillForm(result, { googleCalendarId: 'new@group' });
        await submit(result);

        expect(mockUpdateVehicle.mock.calls[0][1]).toMatchObject({
            googleCalendarId: 'new@group', calendarSyncFailCount: 0,
        });
    });

    it('캘린더 ID가 그대로면 실패 카운터를 건드리지 않는다', async () => {
        const { result } = await setup();
        act(() => result.current.handleEdit(vehicle({ id: 'v7', googleCalendarId: 'same@group' })));
        await fillForm(result, { googleCalendarId: 'same@group' });
        await submit(result);

        expect(mockUpdateVehicle.mock.calls[0][1]).not.toHaveProperty('calendarSyncFailCount');
    });
});

describe('삭제', () => {
    it('운행일지가 있으면 막고 안내한다 — 기록이 지워지면 되돌릴 길이 없다', async () => {
        const { result } = await setup();
        mockHasVehicleDriveLogs.mockResolvedValue(true);

        act(() => result.current.openDeleteModal(vehicle()));
        await act(async () => { await result.current.confirmDelete(); });

        expect(mockDeleteVehicle).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('삭제할 수 없습니다'), 'error');
        expect(result.current.modal).toBeNull();
    });

    it('운행일지가 없으면 삭제한다', async () => {
        const { result } = await setup();
        act(() => result.current.openDeleteModal(vehicle({ id: 'v3' })));
        await act(async () => { await result.current.confirmDelete(); });

        expect(mockDeleteVehicle).toHaveBeenCalledWith('v3');
        expect(result.current.modal).toBeNull();
    });

    it('이미 폐차된 차량은 운행일지가 있어도 완전 삭제한다', async () => {
        const { result } = await setup();
        // 운행일지가 있어도 막히지 않는다는 것이 이 분기의 요점이다
        mockHasVehicleDriveLogs.mockResolvedValue(true);

        act(() => result.current.openDeleteModal(
            vehicle({ id: 'v4', retired: { isRetired: true, reason: '노후', retiredAt: new Date() } }),
        ));
        await act(async () => { await result.current.confirmDelete(); });

        expect(mockDeleteVehicle).toHaveBeenCalledWith('v4');
        expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining('삭제할 수 없습니다'), 'error');
    });

    it('모달이 열려 있지 않으면 아무 것도 하지 않는다', async () => {
        const { result } = await setup();
        await act(async () => { await result.current.confirmDelete(); });
        expect(mockDeleteVehicle).not.toHaveBeenCalled();
    });
});

describe('폐차 / 복원 / 정비 해제', () => {
    it('폐차하면 오늘 이후 예약도 함께 취소한다', async () => {
        const { result } = await setup();
        act(() => result.current.openRetireModal(vehicle({ id: 'v5', displayName: '스타렉스' })));
        await act(async () => { await result.current.confirmRetire('노후'); });

        expect(mockRetireVehicle).toHaveBeenCalledWith('v5', '노후');
        expect(mockCancelReservations).toHaveBeenCalledWith(
            'org1', 'v5', '스타렉스', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), null, '폐차 (노후)',
        );
        expect(result.current.modal).toBeNull();
    });

    it('복원하면 복원만 하고 예약은 건드리지 않는다', async () => {
        const { result } = await setup();
        act(() => result.current.openRestoreModal(vehicle({ id: 'v6' })));
        await act(async () => { await result.current.confirmRestore(); });

        expect(mockRestoreVehicle).toHaveBeenCalledWith('v6');
        expect(mockCancelReservations).not.toHaveBeenCalled();
    });

    it('정비 차단을 해제한다', async () => {
        const { result } = await setup();
        act(() => result.current.openClearMaintenanceModal(vehicle({ id: 'v8' })));
        await act(async () => { await result.current.confirmClearMaintenance(); });

        expect(mockClearMaintenance).toHaveBeenCalledWith('v8');
    });

    it('모달을 닫으면 상태가 비워진다', async () => {
        const { result } = await setup();
        act(() => result.current.openRetireModal(vehicle()));
        expect(result.current.modal).not.toBeNull();

        act(() => result.current.closeModal());
        expect(result.current.modal).toBeNull();
    });
});

describe('캘린더 연동 테스트 결과 반영', () => {
    it('성공하면 실패 상태를 통째로 되돌리고 목록을 다시 읽지 않는다 — 스켈레톤 깜빡임 방지', async () => {
        const { result } = await setup();
        mockGetVehicles.mockClear();

        await act(async () => { await result.current.handleCalendarTestResult('v1', true); });

        // 카운터만 0으로 두면 **통지 표식이 남아 다음에 다시 끊겼을 때 기관에 알리지 못한다.**
        // 이 버튼이 사용자가 안내받는 복구 수단이라, 여기서 빠지면 서버 리셋 경로를 맞춰 놔도
        // 실사용 경로에서 결함이 되살아난다.
        const payload = mockUpdateVehicle.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.calendarSyncFailCount).toBe(0);
        expect(payload).toHaveProperty('calendarSyncLastFailReason');
        expect(payload).toHaveProperty('calendarSyncLastFailStatus');
        expect(payload).toHaveProperty('calendarSyncDisabledNotifiedAt');
        expect(mockGetVehicles).not.toHaveBeenCalled();
        expect(result.current.vehicles[0].calendarSyncFailCount).toBe(0);
    });

    it('실패하면 실패 카운터를 3으로 올려 경고 상태로 만든다', async () => {
        const { result } = await setup();
        await act(async () => { await result.current.handleCalendarTestResult('v1', false); });

        expect(mockUpdateVehicle).toHaveBeenCalledWith('v1', { calendarSyncFailCount: 3 });
        expect(result.current.vehicles[0].calendarSyncFailCount).toBe(3);
    });

    it('저장이 실패해도 화면을 깨뜨리지 않는다', async () => {
        const { result } = await setup();
        mockUpdateVehicle.mockRejectedValue(new Error('boom'));

        await act(async () => { await result.current.handleCalendarTestResult('v1', true); });
        expect(result.current.vehicles).toHaveLength(1);
    });
});
