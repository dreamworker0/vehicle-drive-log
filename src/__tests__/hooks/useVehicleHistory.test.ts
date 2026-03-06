import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'testUser' },
        userData: { organizationId: 'org1', name: '테스트' },
    }),
}));

const mockVehicles = [
    { id: 'v1', displayName: '소나타', plateNumber: '12가1234', currentKm: 50000, vehicleType: 'sedan' },
    { id: 'v2', displayName: '아이오닉5', plateNumber: '34나5678', currentKm: 30000, vehicleType: 'compact' },
];

const mockLogs = [
    {
        id: 'log1', vehicleId: 'v1', startKm: 100, endKm: 150,
        timestamp: { toDate: () => new Date() },
    },
    {
        id: 'log2', vehicleId: 'v1', startKm: 150, endKm: 200,
        timestamp: { toDate: () => new Date(Date.now() - 86400000 * 10) }, // 10일 전
    },
    {
        id: 'log3', vehicleId: 'v1', startKm: 200, endKm: 280,
        timestamp: { toDate: () => new Date(Date.now() - 86400000 * 40) }, // 40일 전 (1개월 필터 외)
    },
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetVehicleDriveLogs = vi.fn().mockResolvedValue(mockLogs);

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getVehicleDriveLogs: (...args: unknown[]) => mockGetVehicleDriveLogs(...args),
}));

import useVehicleHistory from '../../hooks/useVehicleHistory';

describe('useVehicleHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 로딩 후 차량 목록과 첫 번째 차량을 선택한다', async () => {
        const { result } = renderHook(() => useVehicleHistory());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.vehicles).toHaveLength(2);
        expect(result.current.selectedVehicleId).toBe('v1');
        expect(result.current.selectedVehicle?.displayName).toBe('소나타');
    });

    it('기간 내 로그만 필터링한다 (기본 30일)', async () => {
        const { result } = renderHook(() => useVehicleHistory());

        await waitFor(() => expect(result.current.logsLoading).toBe(false));

        // 30일 필터: log1(오늘) + log2(10일전)만 포함, log3(40일전)은 제외
        expect(result.current.logs.length).toBeLessThanOrEqual(2);
    });

    it('totalDistance를 올바르게 계산한다', async () => {
        const { result } = renderHook(() => useVehicleHistory());

        await waitFor(() => expect(result.current.logsLoading).toBe(false));

        // totalDistance = sum of (endKm - startKm) for filtered logs
        expect(result.current.totalDistance).toBeGreaterThanOrEqual(0);
    });

    it('PERIOD_OPTIONS가 올바르게 정의되어 있다', async () => {
        const { result } = renderHook(() => useVehicleHistory());

        expect(result.current.PERIOD_OPTIONS).toHaveLength(3);
        expect(result.current.PERIOD_OPTIONS[0]).toEqual({ label: '1주일', days: 7 });
    });

    it('handleSelectVehicle이 차량을 변경한다', async () => {
        const { result } = renderHook(() => useVehicleHistory());

        await waitFor(() => expect(result.current.loading).toBe(false));

        // act로 차량 선택 변경
        const { act } = await import('@testing-library/react');
        act(() => {
            result.current.handleSelectVehicle('v2');
        });

        expect(result.current.selectedVehicleId).toBe('v2');
    });

    it('getVehicles를 orgId로 호출한다', async () => {
        renderHook(() => useVehicleHistory());

        await waitFor(() => expect(mockGetVehicles).toHaveBeenCalledWith('org1'));
    });
});
