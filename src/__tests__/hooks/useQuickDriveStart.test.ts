import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'emp1', displayName: '김직원', email: 'emp@test.com', getIdToken: vi.fn().mockResolvedValue('fake-token') },
        userData: { organizationId: 'org1', name: '김직원', role: 'employee' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useLocation: () => ({ state: null }),
    useNavigate: () => mockNavigate,
}));

const mockVehicles = [
    { id: 'v1', displayName: '소나타', vehicleType: 'sedan', maintenance: null, retired: null },
    { id: 'v2', displayName: '스타리아', vehicleType: 'van', maintenance: null, retired: null },
];

const mockFavorites = [
    { id: 'fav1', name: '김OO 어르신 댁', address: '서울시 강남구 역삼동 123', userId: 'emp1' },
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetFavorites = vi.fn().mockResolvedValue(mockFavorites);
const mockGetOrganization = vi.fn().mockResolvedValue({ address: '서울시 종로구 1' });
const mockCreateReservationSafe = vi.fn().mockResolvedValue('res1');
const mockUpdateReservationStatus = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getFavorites: (...args: unknown[]) => mockGetFavorites(...args),
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    createReservationSafe: (...args: unknown[]) => mockCreateReservationSafe(...args),
    updateReservationStatus: (...args: unknown[]) => mockUpdateReservationStatus(...args),
}));

vi.mock('../../lib/tmap', () => ({
    getMultiRoute: vi.fn().mockResolvedValue({ distance: 15, duration: 30, tollFee: 0 }),
    isTmapAvailable: () => false, // 테스트에서는 비활성
    VEHICLE_TYPE_TO_CAR_TYPE: { sedan: '0', van: '1' },
}));

vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: () => '2026-03-15',
}));

vi.mock('../../lib/vehicleUtils', () => ({
    isVehicleBlocked: () => false,
    isVehicleRestrictedForUser: () => false,
}));

vi.mock('../../hooks/utils/reservationUtils', () => ({
    calcEndTime: () => '18:00',
}));

import useQuickDriveStart from '../../hooks/useQuickDriveStart';

describe('useQuickDriveStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 로딩 후 차량과 즐겨찾기가 로드된다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.vehicles).toHaveLength(2);
        expect(result.current.favorites).toHaveLength(1);
    });

    it('handleVehicleSelect가 폼을 업데이트한다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        expect(result.current.form.vehicleId).toBe('v1');
        expect(result.current.form.vehicleName).toBe('소나타');
    });

    it('handleFavoriteSelect가 목적지를 설정한다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleFavoriteSelect(mockFavorites[0] as Parameters<typeof result.current.handleFavoriteSelect>[0]);
        });

        expect(result.current.form.destination).toBe('서울시 강남구 역삼동 123');
    });

    it('handleStart — 차량 미선택 시 경고', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockShowToast).toHaveBeenCalledWith('차량을 선택해주세요.', 'warning');
    });

    it('handleStart — 목적지 미입력 시 경고', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockShowToast).toHaveBeenCalledWith('목적지를 입력해주세요.', 'warning');
    });

    it('selectedVehicle가 선택된 차량 객체를 반환한다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.selectedVehicle).toBeUndefined();

        act(() => {
            result.current.handleVehicleSelect('v1');
        });

        expect(result.current.selectedVehicle?.id).toBe('v1');
    });
});
