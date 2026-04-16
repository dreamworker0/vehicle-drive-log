import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        userData: { organizationId: 'org-1', role: 'admin', name: 'Admin' },
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
    toLocalDateStr: () => '2026-03-06',
}));

vi.mock('../../lib/firestore', () => ({
    getVehicles: vi.fn().mockResolvedValue([
        { id: 'v1', displayName: '1호차', vehicleType: 'sedan' },
        { id: 'v2', displayName: '2호차', vehicleType: 'suv' },
    ]),
    getMaintenanceRecords: vi.fn().mockResolvedValue([
        { id: 'r1', vehicleId: 'v1', date: '2026-03-01', type: 'oil', cost: 50000 },
    ]),
    createMaintenanceRecord: vi.fn().mockResolvedValue('new-id'),
    deleteMaintenanceRecord: vi.fn().mockResolvedValue(undefined),
    clearVehicleMaintenanceBlock: vi.fn().mockResolvedValue(undefined),
    cancelVehicleReservations: vi.fn().mockResolvedValue(0),
}));

import useMaintenanceLog, { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';

describe('useMaintenanceLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('MAINTENANCE_TYPES 상수가 9개 항목을 가진다', () => {
        expect(MAINTENANCE_TYPES).toHaveLength(9);
        expect(MAINTENANCE_TYPES[0].value).toBe('oil');
        expect(MAINTENANCE_TYPES[8].value).toBe('other');
    });

    it('초기 로딩 후 차량과 기록이 로드된다', async () => {
        const { result } = renderHook(() => useMaintenanceLog());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.vehicles).toHaveLength(2);
        expect(result.current.filteredRecords).toHaveLength(1);
        expect(result.current.filters).toEqual({
            search: '', vehicleId: '', type: '', startDate: '', endDate: '',
        });
    });

    it('getTypeInfo가 올바른 정보를 반환한다', async () => {
        const { result } = renderHook(() => useMaintenanceLog());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const oilInfo = result.current.getTypeInfo('oil');
        expect(oilInfo.label).toBe('엔진오일');
        expect(oilInfo.icon).toBe('🛢️');

        const unknownInfo = result.current.getTypeInfo('unknown');
        expect(unknownInfo.value).toBe('other'); // 폴백
    });

    it('handleVehicleSelect가 form을 업데이트한다', async () => {
        const { result } = renderHook(() => useMaintenanceLog());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        await waitFor(() => {
            expect(result.current.form.vehicleId).toBe('v1');
            expect(result.current.form.vehicleName).toBe('1호차');
        });
    });

    it('showForm 토글이 동작한다', async () => {
        const { result } = renderHook(() => useMaintenanceLog());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        
        expect(result.current.showForm).toBe(false);

        act(() => {
            result.current.setShowForm(true);
        });

        await waitFor(() => {
            expect(result.current.showForm).toBe(true);
        });
    });
});
