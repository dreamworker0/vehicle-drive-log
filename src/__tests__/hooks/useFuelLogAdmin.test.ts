import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockShowToast = vi.fn();
const mockConfirm = vi.fn().mockResolvedValue(true);

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ user: { uid: 'admin-1' }, userData: { organizationId: 'org-A' } }),
}));

const mockGetVehicles = vi.fn();
const mockGetFuelLogs = vi.fn();
const mockDeleteFuelLog = vi.fn().mockResolvedValue(undefined);
const mockUpdateFuelLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getFuelLogs: (...a: unknown[]) => mockGetFuelLogs(...a),
    deleteFuelLog: (...a: unknown[]) => mockDeleteFuelLog(...a),
    updateFuelLog: (...a: unknown[]) => mockUpdateFuelLog(...a),
}));

import useFuelLogAdmin from '../../hooks/useFuelLogAdmin';

const VEHICLES = [
    { id: 'v1', vehicleType: 'sedan', fuelType: 'gasoline' },
    { id: 'v2', vehicleType: 'van', fuelType: 'electric' },
];
const RECORDS = [
    { id: 'r1', vehicleId: 'v1', vehicleName: '쏘나타', driverUid: 'emp-1', driverName: '김직원', date: '2026-08-01', meterReading: 51000, fuelCost: 50000, fuelAmount: 30 },
    { id: 'r2', vehicleId: 'v2', vehicleName: '카니발', driverUid: 'emp-2', driverName: '이직원', date: '2026-08-05', meterReading: 32000, fuelCost: 20000, fuelAmount: 10 },
];

/** 폼 제출 이벤트 대역 — 훅은 preventDefault만 쓴다 */
const submitEvent = () => ({ preventDefault: () => {} }) as React.FormEvent;

describe('useFuelLogAdmin (useBaseFuelLog 위임 구조)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockGetFuelLogs.mockResolvedValue(RECORDS);
        mockConfirm.mockResolvedValue(true);
    });

    it('기관 차량·주유 기록을 로드하고 로딩이 끝난다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockGetVehicles).toHaveBeenCalledWith('org-A');
        expect(mockGetFuelLogs).toHaveBeenCalledWith('org-A');
        expect(result.current.filteredRecords).toHaveLength(2);
        expect(result.current.vehicles).toHaveLength(2);
    });

    it('차량 정보를 합쳐 vehicleType·fuelType을 채운다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const [first] = result.current.filteredRecords;
        expect(first.vehicleType).toBe('sedan');
        expect(first.fuelType).toBe('gasoline');
    });

    it('합계는 화면에 보이는 필터링 결과 기준으로 계산한다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.totalCost).toBe(70000);
        expect(result.current.totalAmount).toBe(40);

        act(() => { result.current.setFilters(f => ({ ...f, vehicleId: 'v1' })); });

        // 필터를 걸면 목록과 합계가 함께 줄어야 한다 — 어긋나면 화면 숫자가 거짓이 된다.
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(1));
        expect(result.current.totalCost).toBe(50000);
        expect(result.current.totalAmount).toBe(30);
    });

    it('검색어는 차량명·운전자명에 적용되고 resetFilters로 되돌린다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.setFilters(f => ({ ...f, search: '이직원' })); });
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(1));
        expect(result.current.filteredRecords[0].id).toBe('r2');

        act(() => { result.current.resetFilters(); });
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(2));
    });

    it('날짜 범위 필터가 경계를 포함해 동작한다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.setFilters(f => ({ ...f, startDate: '2026-08-05' })); });
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(1));
        expect(result.current.filteredRecords[0].id).toBe('r2');
    });

    it('관리자 삭제는 본인 확인 없이 타인 기록도 지운다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            // 본인이 아닌 직원(emp-1)의 기록도 관리자는 삭제할 수 있어야 한다.
            await result.current.handleDelete(RECORDS[0] as never);
        });

        expect(mockDeleteFuelLog).toHaveBeenCalledWith('r1');
        expect(mockShowToast).toHaveBeenCalledWith('주유 기록이 삭제되었습니다.', 'success');
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(1));
    });

    it('삭제 확인창에서 취소하면 아무것도 지우지 않는다', async () => {
        mockConfirm.mockResolvedValue(false);
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.handleDelete(RECORDS[0] as never); });

        expect(mockDeleteFuelLog).not.toHaveBeenCalled();
        expect(result.current.filteredRecords).toHaveLength(2);
    });
    it('관리자가 타인 기록을 정정하면 수정 API가 불리고 목록이 그 자리에서 갱신된다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        expect(result.current.editingRecord?.id).toBe('r1');
        // 폼은 기존 값으로 채워진다 — 빈 칸부터 다시 쓰게 하면 정정이 아니라 재입력이다.
        expect(result.current.form.fuelAmount).toBe('30');

        act(() => { result.current.setForm(f => ({ ...f, fuelAmount: '25.5', fuelCost: '42000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockUpdateFuelLog).toHaveBeenCalledWith('r1', expect.objectContaining({
            fuelAmount: 25.5, fuelCost: 42000, vehicleId: 'v1', date: '2026-08-01',
        }));
        // 주유원은 건드리지 않는다 — 누가 넣은 기록인가는 기록의 정체성이다.
        expect(mockUpdateFuelLog.mock.calls[0][1]).not.toHaveProperty('driverUid');

        const updated = result.current.filteredRecords.find(r => r.id === 'r1');
        expect(updated?.fuelAmount).toBe(25.5);
        // 목록을 다시 읽지 않고 그 자리만 갱신한다(초기 로드 1회뿐).
        expect(mockGetFuelLogs).toHaveBeenCalledTimes(1);
        // 수정자가 남아야 화면에 '관리자 수정' 표시가 뜬다.
        expect(updated?.lastEditedByUid).toBe('admin-1');
        expect(result.current.editingRecord).toBeNull();
    });

    it('필수 항목이 비거나 음수면 저장하지 않고 안내만 한다', async () => {
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.handleEdit(RECORDS[0] as never); });

        act(() => { result.current.setForm(f => ({ ...f, fuelCost: '' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });
        expect(mockUpdateFuelLog).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('모든 필수 항목을 입력해주세요.', 'warning');

        act(() => { result.current.setForm(f => ({ ...f, fuelCost: '-1000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });
        expect(mockUpdateFuelLog).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('주유금액에 음수를 입력할 수 없습니다.', 'warning');
    });

    it('저장에 실패하면 목록을 바꾸지 않고 수정 상태를 유지한다', async () => {
        mockUpdateFuelLog.mockRejectedValueOnce(new Error('permission-denied'));
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, fuelCost: '42000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockShowToast).toHaveBeenCalledWith('수정에 실패했습니다.', 'error');
        // 실패했는데 화면만 바뀌면 사용자는 고쳐진 줄 안다.
        expect(result.current.filteredRecords.find(r => r.id === 'r1')?.fuelCost).toBe(50000);
        expect(result.current.editingRecord?.id).toBe('r1');
    });
    it('지수 표기(1e5)를 1로 읽지 않고, 0으로 저장된 값도 폼에 채운다', async () => {
        // ① `<input type="number">`는 '1e5'를 유효한 값으로 넘기는데 parseInt는 1로 읽는다 —
        //    50,000km가 1km로 조용히 저장됐다.
        // ② 0을 `|| ''`로 비우면 필수값 검사에 걸려 그 기록은 아예 고칠 수 없게 된다.
        mockGetFuelLogs.mockResolvedValue([{ ...RECORDS[0], meterReading: 0 }]);
        const { result } = renderHook(() => useFuelLogAdmin());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.handleEdit(result.current.filteredRecords[0] as never); });
        expect(result.current.form.meterReading).toBe('0');

        act(() => { result.current.setForm(f => ({ ...f, meterReading: '1e5', fuelCost: '1e5' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockUpdateFuelLog).toHaveBeenCalledWith('r1', expect.objectContaining({
            meterReading: 100000, fuelCost: 100000,
        }));
    });
});
