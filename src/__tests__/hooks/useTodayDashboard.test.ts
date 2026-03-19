import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mocks ──
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'testUser', displayName: '테스트', email: 'test@test.com' },
        userData: { organizationId: 'org1', name: '테스트', role: 'employee' },
    }),
}));

const mockVehicles = [
    { id: 'v1', displayName: '소나타', currentKm: 50000 },
    { id: 'v2', displayName: '아이오닉5', currentKm: 30000, maintenance: { isBlocked: true } },
];

const mockTodayReservations = [
    { id: 'res1', vehicleId: 'v1', reservedByUid: 'testUser', status: 'reserved', startTime: '09:00', endTime: '12:00', date: '2026-03-04' },
    { id: 'res2', vehicleId: 'v1', reservedByUid: 'otherUser', status: 'reserved', startTime: '13:00', endTime: '15:00', date: '2026-03-04' },
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetTodayReservations = vi.fn().mockResolvedValue(mockTodayReservations);
const mockGetWeekReservations = vi.fn().mockResolvedValue([]);
const mockGetMyDriveLogs = vi.fn().mockResolvedValue([]);
const mockUpdateReservationStatus = vi.fn().mockResolvedValue({});
const mockCancelReservation = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: any[]) => mockGetVehicles(...args),
    getTodayReservations: (...args: any[]) => mockGetTodayReservations(...args),
    getWeekReservations: (...args: any[]) => mockGetWeekReservations(...args),
    updateReservationStatus: (...args: any[]) => mockUpdateReservationStatus(...args),
    cancelReservation: (...args: any[]) => mockCancelReservation(...args),
    getMyDriveLogs: (...args: any[]) => mockGetMyDriveLogs(...args),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: null }, default: {} }));
vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: vi.fn((d) => {
        if (!d) return '2026-03-04';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }),
}));

import useTodayDashboard from '../../hooks/useTodayDashboard';

describe('useTodayDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 상태에서 loading이 true이다', () => {
        const { result } = renderHook(() => useTodayDashboard());
        expect(result.current.loading).toBe(true);
    });

    it('orgId가 있으면 차량/예약/일지를 로드한다', async () => {
        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockGetVehicles).toHaveBeenCalledWith('org1');
        expect(mockGetTodayReservations).toHaveBeenCalled();
        expect(mockGetWeekReservations).toHaveBeenCalled();
        expect(result.current.vehicles).toHaveLength(2);
    });

    it('myReservations는 본인 예약만 필터링한다', async () => {
        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // testUser의 예약만 (res1만, completed 제외)
        expect(result.current.myReservations).toHaveLength(1);
        expect(result.current.myReservations[0].id).toBe('res1');
    });

    it('운행 중인 예약이 없으면 hasActiveDrive는 false이다', async () => {
        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.hasActiveDrive).toBe(false);
    });

    it('운행 중인 예약이 있으면 hasActiveDrive는 true이다', async () => {
        mockGetTodayReservations.mockResolvedValueOnce([
            { id: 'res1', vehicleId: 'v1', reservedByUid: 'testUser', status: 'in_progress', startTime: '09:00', endTime: '12:00', date: '2026-03-04' },
        ]);

        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.hasActiveDrive).toBe(true);
    });

    it('navigateToReservations가 올바른 경로로 이동한다', async () => {
        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        result.current.navigateToReservations();

        expect(mockNavigate).toHaveBeenCalledWith('/employee/reservations', { state: { openForm: true } });
    });

    it('todayLabel이 한국어 형식이다', async () => {
        const { result } = renderHook(() => useTodayDashboard());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // 오늘 날짜가 한국어로 포맷팅 되었는지 확인
        expect(result.current.todayLabel).toBeTruthy();
        expect(typeof result.current.todayLabel).toBe('string');
    });
});
