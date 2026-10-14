import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Reservation } from '../../types/reservation';

// 운행 시작(상태 변경)과 길안내(딥링크)를 분리한 계약을 고정한다.
// 예전에는 한 try 안에 있어, 상태를 in_progress로 바꾼 뒤 길안내 준비가 실패하면
// "운행 시작에 실패했습니다"가 떴다 — 실제로는 운행이 이미 시작된 상태였다(2026-10-14 감사).

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const mockUpdateStatus = vi.fn();
vi.mock('../../lib/firestore', () => ({
    updateReservationStatus: (...args: unknown[]) => mockUpdateStatus(...args),
    cancelReservation: vi.fn(),
}));
vi.mock('../../hooks/useTodayDashboard', () => ({ invalidateDashboardCache: vi.fn() }));

const mockDeeplink = vi.fn();
vi.mock('../../lib/tmap', () => ({
    getNavigationDeeplink: (...args: unknown[]) => mockDeeplink(...args),
}));

import useDashboardActions from '../../hooks/useDashboardActions';

const reservation = { id: 'r1', vehicleId: 'v1', vehicleName: '1호차', destination: '서울시청' } as Reservation;

function setup() {
    const setLocalStartedIds = vi.fn();
    const { result } = renderHook(() => useDashboardActions({
        vehicles: [],
        setLocalStartedIds,
        setLocalCancelledIds: vi.fn(),
    }));
    return { result, setLocalStartedIds };
}

describe('useDashboardActions.handleStartNavigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdateStatus.mockResolvedValue(undefined);
    });

    it('길안내 준비가 실패해도 운행 시작은 성공으로 반영하고, 시작 실패라고 말하지 않는다', async () => {
        mockDeeplink.mockRejectedValueOnce(new Error('geocode failed'));
        const { result, setLocalStartedIds } = setup();

        await act(async () => { await result.current.handleStartNavigation(reservation, 'tmap'); });

        expect(mockUpdateStatus).toHaveBeenCalledWith('r1', 'in_progress', expect.objectContaining({ actualStartTime: expect.any(String) }));
        expect(setLocalStartedIds).toHaveBeenCalled();
        expect(mockShowToast).not.toHaveBeenCalledWith('운행 시작에 실패했습니다.', 'error');
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('운행은 시작되었어요'), 'error');
        expect(result.current.startingId).toBeNull();
    });

    it('상태 변경이 실패하면 운행 시작 실패로 알리고 길안내를 열지 않는다', async () => {
        mockUpdateStatus.mockRejectedValueOnce(new Error('permission-denied'));
        const { result, setLocalStartedIds } = setup();

        await act(async () => { await result.current.handleStartNavigation(reservation, 'tmap'); });

        expect(mockShowToast).toHaveBeenCalledWith('운행 시작에 실패했습니다.', 'error');
        expect(setLocalStartedIds).not.toHaveBeenCalled();
        expect(mockDeeplink).not.toHaveBeenCalled();
        expect(result.current.startingId).toBeNull();
    });
});
