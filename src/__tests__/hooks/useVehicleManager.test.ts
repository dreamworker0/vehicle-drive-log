import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'admin1' },
        userData: { organizationId: 'org1', name: '관리자', role: 'admin' },
    }),
}));

const mockVehicles = [
    { id: 'v1', name: '소나타', displayName: '소나타', plateNumber: '12가1234', currentKm: 50000, type: 'sedan', vehicleType: 'sedan', organizationId: 'org1' },
    { id: 'v2', name: '아이오닉5', displayName: '아이오닉5', plateNumber: '34나5678', currentKm: 30000, type: 'compact', vehicleType: 'compact', organizationId: 'org1' },
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockCreateVehicle = vi.fn().mockResolvedValue('v3');
const mockUpdateVehicle = vi.fn().mockResolvedValue({});
const mockDeleteVehicle = vi.fn().mockResolvedValue({});
const mockClearVehicleMaintenanceBlock = vi.fn().mockResolvedValue({});
const mockRetireVehicle = vi.fn().mockResolvedValue({});
const mockRestoreVehicle = vi.fn().mockResolvedValue({});
const mockCancelVehicleReservations = vi.fn().mockResolvedValue({});
const mockHasVehicleDriveLogs = vi.fn().mockResolvedValue(false);

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    createVehicle: (...args: unknown[]) => mockCreateVehicle(...args),
    updateVehicle: (...args: unknown[]) => mockUpdateVehicle(...args),
    deleteVehicle: (...args: unknown[]) => mockDeleteVehicle(...args),
    clearVehicleMaintenanceBlock: (...args: unknown[]) => mockClearVehicleMaintenanceBlock(...args),
    retireVehicle: (...args: unknown[]) => mockRetireVehicle(...args),
    restoreVehicle: (...args: unknown[]) => mockRestoreVehicle(...args),
    cancelVehicleReservations: (...args: unknown[]) => mockCancelVehicleReservations(...args),
    hasVehicleDriveLogs: (...args: unknown[]) => mockHasVehicleDriveLogs(...args),
}));

import useVehicleManager from '../../hooks/useVehicleManager';

describe('useVehicleManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 로딩 후 차량 목록을 가져온다', async () => {
        const { result } = renderHook(() => useVehicleManager());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.vehicles).toHaveLength(2);
    });

    it('getVehicles를 orgId로 호출한다', async () => {
        renderHook(() => useVehicleManager());

        await waitFor(() => expect(mockGetVehicles).toHaveBeenCalledWith('org1'));
    });

    it('showForm 토글이 동작한다', async () => {
        const { result } = renderHook(() => useVehicleManager());
        const { act } = await import('@testing-library/react');

        // 초기 비동기 데이터 로딩 대기
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.showForm).toBe(false);

        act(() => {
            result.current.setShowForm(true);
        });

        expect(result.current.showForm).toBe(true);
    });

    it('modal 상태가 초기에 null이다', async () => {
        const { result } = renderHook(() => useVehicleManager());

        // 초기 비동기 데이터 로딩 대기
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.modal).toBeNull();
    });
});
