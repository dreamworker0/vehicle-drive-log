import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOrgSites } from '../../lib/orgSites';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ──
const mockOrgFeatures = {
    passenger: true,
    passengerAllowList: true,
    passengerAllowSearch: true,
    passengerAllowCount: true,
    // '예약·바로 운행에서 미리 입력' — 바로 운행의 동승자도 이 토글을 따른다
    reservationPassenger: true,
};

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'emp1', displayName: '김직원', email: 'emp@test.com', getIdToken: vi.fn().mockResolvedValue('fake-token') },
        userData: { organizationId: 'org1', name: '김직원', role: 'employee' },
        orgFeatures: mockOrgFeatures,
        // 분관을 등록하지 않은 기관 — 출발지는 기관 주소 하나뿐이다
        orgSites: resolveOrgSites(null),
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

const mockMembers = [
    { id: 'emp1', name: '김직원', status: 'active' },   // 본인 — 동승자 후보에서 빠져야 한다
    { id: 'emp2', name: '이동료', status: 'active' },
    { id: 'emp3', name: '박퇴사', status: 'disabled' }, // 비활성 — 후보에서 빠져야 한다
];

const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetFavorites = vi.fn().mockResolvedValue(mockFavorites);
const mockGetOrganization = vi.fn().mockResolvedValue({ address: '서울시 종로구 1' });
const mockGetOrganizationMembers = vi.fn().mockResolvedValue(mockMembers);
const mockCreateReservationSafe = vi.fn().mockResolvedValue('res1');
const mockUpdateReservationStatus = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getFavorites: (...args: unknown[]) => mockGetFavorites(...args),
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    getOrganizationMembers: (...args: unknown[]) => mockGetOrganizationMembers(...args),
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

    it('handleDestinationChange가 목적지를 설정한다 (여러 곳은 쉼표로 이어진다)', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleDestinationChange('서울시 강남구 역삼동 123, 서울역');
        });

        expect(result.current.form.destination).toBe('서울시 강남구 역삼동 123, 서울역');
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

    it('동승자 후보에서 본인과 비활성 계정을 제외한다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.members.map(m => m.id)).toEqual(['emp2']);
        expect(result.current.passengerOptions.enabled).toBe(true);
    });

    it('선택한 동승자가 예약 생성 데이터에 포함된다', async () => {
        const { result } = renderHook(() => useQuickDriveStart());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleVehicleSelect('v1');
            result.current.setForm(prev => ({ ...prev, destination: '서울역' }));
        });

        act(() => {
            result.current.handlePassengerChange({ passengerUids: ['emp2'] });
            result.current.handlePassengerChange({ passengerExternalNames: '홍길동', passengerCount: 2 });
        });

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockCreateReservationSafe).toHaveBeenCalledWith(
            expect.objectContaining({
                isQuickDrive: true,
                passengerUids: ['emp2'],
                passengerNames: ['이동료', '홍길동'],
                passengerCount: 2,
            }),
        );
    });

    it.each([
        ['동승자 기능', 'passenger' as const],
        ['미리 입력 위치 설정', 'reservationPassenger' as const],
    ])('%s이 꺼진 기관에서는 동승자 입력이 없고 직원 목록도 읽지 않는다', async (_label, key) => {
        mockOrgFeatures[key] = false;
        try {
            const { result } = renderHook(() => useQuickDriveStart());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(mockGetOrganizationMembers).not.toHaveBeenCalled();
            expect(result.current.members).toHaveLength(0);
            expect(result.current.passengerOptions.enabled).toBe(false);
        } finally {
            mockOrgFeatures[key] = true;
        }
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
