import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockShowToast = vi.fn();
const mockConfirm = vi.fn().mockResolvedValue(true);

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ userData: { organizationId: 'org-A' } }),
}));

const mockGetVehicles = vi.fn();
const mockGetFuelLogs = vi.fn();
const mockDeleteFuelLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getFuelLogs: (...a: unknown[]) => mockGetFuelLogs(...a),
    deleteFuelLog: (...a: unknown[]) => mockDeleteFuelLog(...a),
}));

import useFuelLogAdmin from '../../hooks/useFuelLogAdmin';

const VEHICLES = [
    { id: 'v1', vehicleType: 'sedan', fuelType: 'gasoline' },
    { id: 'v2', vehicleType: 'van', fuelType: 'electric' },
];
const RECORDS = [
    { id: 'r1', vehicleId: 'v1', vehicleName: '쏘나타', driverName: '김직원', date: '2026-08-01', fuelCost: 50000, fuelAmount: 30 },
    { id: 'r2', vehicleId: 'v2', vehicleName: '카니발', driverName: '이직원', date: '2026-08-05', fuelCost: 20000, fuelAmount: 10 },
];

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
            // driverUid가 없는(= 본인 것이 아닌) 기록도 관리자는 삭제할 수 있어야 한다.
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
});
