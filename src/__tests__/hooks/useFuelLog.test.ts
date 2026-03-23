import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'emp1', displayName: '김직원', email: 'emp@test.com' },
        userData: { organizationId: 'org1', name: '김직원', role: 'employee' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: () => '2026-03-15',
}));

const mockVehicles = [
    { id: 'v1', displayName: '소나타', name: '소나타', currentKm: 50000, vehicleType: 'sedan' },
    { id: 'v2', displayName: '아이오닉5', name: '아이오닉5', currentKm: 30000, vehicleType: 'compact' },
];

const mockRecords = [
    { id: 'f1', vehicleId: 'v1', vehicleName: '소나타', driverUid: 'emp1', date: '2026-03-10', meterReading: 51000, fuelAmount: 40, fuelCost: 60000, notes: '' },
    { id: 'f2', vehicleId: 'v2', vehicleName: '아이오닉5', driverUid: 'other', date: '2026-03-11', meterReading: 31000, fuelAmount: 30, fuelCost: 45000, notes: '' },
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetFuelLogs = vi.fn().mockResolvedValue(mockRecords);
const mockCreateFuelLog = vi.fn().mockResolvedValue('f3');
const mockUpdateFuelLog = vi.fn().mockResolvedValue({});
const mockDeleteFuelLog = vi.fn().mockResolvedValue({});
const mockGetTodayReservations = vi.fn().mockResolvedValue([]);

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getFuelLogs: (...args: unknown[]) => mockGetFuelLogs(...args),
    createFuelLog: (...args: unknown[]) => mockCreateFuelLog(...args),
    updateFuelLog: (...args: unknown[]) => mockUpdateFuelLog(...args),
    deleteFuelLog: (...args: unknown[]) => mockDeleteFuelLog(...args),
    getTodayReservations: (...args: unknown[]) => mockGetTodayReservations(...args),
}));

vi.mock('../../lib/ocr', () => ({
    ocrDashboard: vi.fn().mockResolvedValue({ km: 55000, raw: '55000 km' }),
}));

import useFuelLog from '../../hooks/useFuelLog';

describe('useFuelLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue(mockVehicles);
        mockGetFuelLogs.mockResolvedValue(mockRecords);
    });

    it('초기 로딩 후 차량 및 기록이 로드된다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.vehicles).toHaveLength(2);
        expect(result.current.enrichedRecords).toHaveLength(2);
    });

    it('합계(totalCost, totalAmount)가 올바르게 계산된다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.totalCost).toBe(105000); // 60000 + 45000
        expect(result.current.totalAmount).toBe(70); // 40 + 30
    });

    it('handleVehicleSelect가 폼을 업데이트한다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        expect(result.current.form.vehicleId).toBe('v1');
        expect(result.current.form.vehicleName).toBe('소나타');
    });

    it('handleEdit — 본인 기록만 수정 가능', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        // 다른 사람의 기록 수정 시도 → 경고 토스트
        act(() => {
            result.current.handleEdit(mockRecords[1] as Parameters<typeof result.current.handleEdit>[0]);
        });

        expect(mockShowToast).toHaveBeenCalledWith('본인의 주유 기록만 수정할 수 있습니다.', 'warning');

        // 본인 기록 수정 → 폼에 데이터 채움
        act(() => {
            result.current.handleEdit(mockRecords[0] as Parameters<typeof result.current.handleEdit>[0]);
        });

        expect(result.current.editingId).toBe('f1');
        expect(result.current.form.vehicleId).toBe('v1');
    });

    it('handleCancelEdit이 수정 모드를 초기화한다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleEdit(mockRecords[0] as Parameters<typeof result.current.handleEdit>[0]);
        });
        expect(result.current.editingId).toBe('f1');

        act(() => {
            result.current.handleCancelEdit();
        });
        expect(result.current.editingId).toBeNull();
        expect(result.current.showForm).toBe(false);
    });

    it('showForm 토글이 동작한다', async () => {
        const { result } = renderHook(() => useFuelLog());

        expect(result.current.showForm).toBe(false);

        act(() => {
            result.current.setShowForm(true);
        });

        expect(result.current.showForm).toBe(true);
    });

    it('selectedVehicleKm이 선택된 차량의 km을 반환한다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        expect(result.current.selectedVehicleKm).toBe(50000);
    });

    it('enrichedRecords에 vehicleType이 병합된다', async () => {
        const { result } = renderHook(() => useFuelLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.enrichedRecords[0].vehicleType).toBe('sedan');
    });
});
