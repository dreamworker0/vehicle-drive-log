import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/employee/reservations' }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useRetry', () => ({
    default: () => { },
}));

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'testUser', displayName: '테스트', email: 'test@test.com' },
        userData: { organizationId: 'org1', name: '테스트', role: 'employee' },
    }),
}));

const mockGetVehicles = vi.fn().mockResolvedValue([
    { id: 'v1', displayName: '소나타', vehicleType: 'sedan' },
    { id: 'v2', displayName: '아이오닉5', vehicleType: 'suv' },
]);
const mockCancelReservation = vi.fn().mockResolvedValue({});
const mockGetFavorites = vi.fn().mockResolvedValue([]);
const mockCreateFavorite = vi.fn().mockResolvedValue({ id: 'fav1' });
const mockCreateReservationSafe = vi.fn().mockResolvedValue({ reservationId: 'res1' });
const mockSubscribeReservations = vi.fn((orgId, cb) => {
    cb([]); // 빈 예약 목록으로 콜백
    return vi.fn(); // unsubscribe
});
const mockGetCustomHolidays = vi.fn().mockResolvedValue([]);
const mockGetOrganization = vi.fn().mockResolvedValue({ address: '서울시 중구' });
const mockGetOrganizationMembers = vi.fn().mockResolvedValue([]);
const mockUpdateReservation = vi.fn().mockResolvedValue({});
const mockCreateNotification = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args) => mockGetVehicles(...args),
    createReservationSafe: (...args) => mockCreateReservationSafe(...args),
    cancelReservation: (...args) => mockCancelReservation(...args),
    getFavorites: (...args) => mockGetFavorites(...args),
    createFavorite: (...args) => mockCreateFavorite(...args),
    subscribeReservations: (...args) => mockSubscribeReservations(...args),
    getCustomHolidays: (...args) => mockGetCustomHolidays(...args),
    getOrganization: (...args) => mockGetOrganization(...args),
    getOrganizationMembers: (...args) => mockGetOrganizationMembers(...args),
    updateReservation: (...args) => mockUpdateReservation(...args),
    createNotification: (...args) => mockCreateNotification(...args),
    getReservations: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, default: {} }));
vi.mock('../../lib/holidayApi', () => ({
    fetchPublicHolidays: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../lib/tmap', () => ({
    getMultiRoute: vi.fn().mockResolvedValue(null),
    parseDestinations: vi.fn((s) => s ? s.split(',').map(d => d.trim()) : []),
    getNavigationDeeplink: vi.fn().mockReturnValue('tmap://'),
    isTmapAvailable: vi.fn().mockReturnValue(false),
    VEHICLE_TYPE_TO_CAR_TYPE: {},
}));
vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: vi.fn(() => '2026-03-04'),
}));

import useReservationCalendar from '../../hooks/useReservationCalendar';

describe('useReservationCalendar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // subscribeReservations 재설정
        mockSubscribeReservations.mockImplementation((orgId, cb) => {
            cb([]);
            return vi.fn();
        });
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

        const initialMonth = result.current.currentDate.getMonth();

        act(() => {
            result.current.nextMonth();
        });

        const nextMonthVal = result.current.currentDate.getMonth();
        expect(nextMonthVal).toBe((initialMonth + 1) % 12);

        act(() => {
            result.current.prevMonth();
        });

        expect(result.current.currentDate.getMonth()).toBe(initialMonth);
    });

    it('handleCancel이 예약을 취소한다', async () => {
        mockSubscribeReservations.mockImplementation((orgId, cb) => {
            cb([
                { id: 'res1', vehicleId: 'v1', date: '2026-03-10', startTime: '09:00', endTime: '12:00', status: 'reserved', reservedByUid: 'testUser' },
            ]);
            return vi.fn();
        });

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
