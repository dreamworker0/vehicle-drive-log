import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──
const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/employee/reservations' }),
    useSearchParams: () => [mockSearchParams],
}));

const mockShowToast = vi.fn();
const mockToastReturn = { showToast: mockShowToast };
vi.mock('../../hooks/useToast', () => ({
    useToast: () => mockToastReturn,
}));

vi.mock('../../hooks/useRetry', () => ({
    default: () => { },
}));

const mockUser = { uid: 'testUser', displayName: '테스트', email: 'test@test.com' };
const mockUserData = { organizationId: 'org1', name: '테스트', role: 'employee' };
const mockAuthReturn = { user: mockUser, userData: mockUserData };
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => mockAuthReturn,
}));

const mockGetVehicles = vi.fn().mockResolvedValue([
    { id: 'v1', displayName: '소나타', vehicleType: 'sedan' },
    { id: 'v2', displayName: '아이오닉5', vehicleType: 'suv' },
]);
const mockCancelReservation = vi.fn().mockResolvedValue({});
const mockGetFavorites = vi.fn().mockResolvedValue([]);
const mockCreateFavorite = vi.fn().mockResolvedValue({ id: 'fav1' });
const mockCreateReservation = vi.fn().mockResolvedValue({ reservationId: 'res1' });
const mockGetReservationsByDateRange = vi.fn().mockResolvedValue([]);
const mockGetOrganizationMembers = vi.fn().mockResolvedValue([]);
const mockUpdateReservation = vi.fn().mockResolvedValue({});
const mockCreateNotification = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: any[]) => mockGetVehicles(...args),
    createReservation: (...args: any[]) => mockCreateReservation(...args),
    cancelReservation: (...args: any[]) => mockCancelReservation(...args),
    getFavorites: (...args: any[]) => mockGetFavorites(...args),
    createFavorite: (...args: any[]) => mockCreateFavorite(...args),
    getReservationsByDateRange: (...args: any[]) => mockGetReservationsByDateRange(...args),
    getOrganizationMembers: (...args: any[]) => mockGetOrganizationMembers(...args),
    updateReservation: (...args: any[]) => mockUpdateReservation(...args),
    createNotification: (...args: any[]) => mockCreateNotification(...args),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, default: {} }));
vi.mock('../../lib/holiday', () => ({
    getHolidays: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../lib/tmap', () => ({
    getRouteInfo: vi.fn().mockResolvedValue(null),
    getMultiRoute: vi.fn().mockResolvedValue(null),
    parseDestinations: vi.fn((s: string) => s ? s.split(',').map((d: string) => d.trim()) : []),
    getNavigationDeeplink: vi.fn().mockReturnValue('tmap://'),
    isTmapAvailable: vi.fn().mockReturnValue(false),
    VEHICLE_TYPE_TO_CAR_TYPE: {},
}));
vi.mock('../../hooks/utils/reservationUtils', () => ({
    calcEndTime: vi.fn((start: string) => start),
}));

import useReservationCalendar from '../../hooks/useReservationCalendar';

describe('useReservationCalendar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 상태에서 loading이 true이다', () => {
        const { result } = renderHook(() => useReservationCalendar());
        expect(result.current.loading).toBe(true);
    });

    it('orgId가 있으면 차량을 로드한다', async () => {
        const { result } = renderHook(() => useReservationCalendar());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockGetVehicles).toHaveBeenCalledWith('org1');
        expect(result.current.vehicles).toHaveLength(2);
    });

    it('날짜 선택 시 handleDateSelect가 상태를 업데이트한다', async () => {
        const { result } = renderHook(() => useReservationCalendar());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.handleDateSelect('2026-03-10');
        });

        expect(result.current.selectedDate).toBe('2026-03-10');
    });

    it('prevMonth/nextMonth로 기준 월을 이동한다', async () => {
        const { result } = renderHook(() => useReservationCalendar());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const initialLabel = result.current.monthLabel;

        act(() => {
            result.current.nextMonth();
        });

        expect(result.current.monthLabel).not.toBe(initialLabel);

        act(() => {
            result.current.prevMonth();
        });

        expect(result.current.monthLabel).toBe(initialLabel);
    });

    it('handleCancel이 예약을 취소한다', async () => {
        mockGetReservationsByDateRange.mockResolvedValue([
            { id: 'res1', vehicleId: 'v1', date: '2026-03-10', startTime: '09:00', endTime: '12:00', status: 'reserved', reservedByUid: 'testUser' },
        ]);

        const { result } = renderHook(() => useReservationCalendar());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        vi.spyOn(window, 'confirm').mockReturnValue(true);

        await act(async () => {
            await result.current.handleCancel('res1');
        });

        expect(mockCancelReservation).toHaveBeenCalledWith('res1');
        vi.restoreAllMocks();
    });

    it('calendarDays가 올바른 달력 데이터를 생성한다', async () => {
        const { result } = renderHook(() => useReservationCalendar());

        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // calendarDays는 첫 주 빈칸 + 해당 월 날짜들
        expect(result.current.calendarDays.length).toBeGreaterThan(0);
        // null이 아닌 엔트리는 date, dateStr, reservations 필드를 가짐
        const validDays = result.current.calendarDays.filter(Boolean);
        expect(validDays.length).toBeGreaterThan(0);
        expect(validDays[0]).toHaveProperty('date');
        expect(validDays[0]).toHaveProperty('dateStr');
        expect(validDays[0]).toHaveProperty('reservations');
    });
});
