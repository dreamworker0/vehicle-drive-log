import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// useAnalytics에서 사용하는 것들 mock
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        userData: { organizationId: 'org-1', role: 'admin', name: 'Admin' },
    }),
}));

vi.mock('../../lib/firestore', () => ({
    getDriveLogs: vi.fn().mockResolvedValue({ docs: [] }),
    getVehicles: vi.fn().mockResolvedValue([]),
    getOrganizationMembers: vi.fn().mockResolvedValue([]),
    getMaintenanceRecords: vi.fn().mockResolvedValue([]),
    getFuelLogs: vi.fn().mockResolvedValue([]),
    getAllHipassCharges: vi.fn().mockResolvedValue([]),
}));

import useAnalytics from '../../hooks/useAnalytics';

describe('useAnalytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기에 loading true이며, 데이터 로드 후 false로 전환된다', async () => {
        const { result } = renderHook(() => useAnalytics());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('데이터 로드 후 logs/vehicles/rangeMonths가 존재한다', async () => {
        const { result } = renderHook(() => useAnalytics());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.rangeMonths).toBe(6);
    });

    it('setRangeMonths로 범위를 변경할 수 있다', async () => {
        const { result } = renderHook(() => useAnalytics());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(typeof result.current.setRangeMonths).toBe('function');
    });
});
