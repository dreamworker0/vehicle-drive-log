import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mocks ──
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/employee/drive-log' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const mockShowToast = vi.fn();
const mockToastReturn = { showToast: mockShowToast };
vi.mock('../../hooks/useToast', () => ({
    useToast: () => mockToastReturn,
}));

vi.mock('../../hooks/useRetry', () => ({
    default: () => ({
        runWithRetry: async (_: string, fn: () => Promise<unknown>) => await fn(),
        resetRetry: vi.fn(),
        isNetworkError: () => false,
    }),
}));

const mockOcrReturn = {
    ocrLoading: false,
    ocrError: null,
    ocrSuccess: false,
    ocrReportSending: false,
    ocrReportSent: false,
    cameraInputRef: { current: null },
    endKmInputRef: { current: null },
    handleOcrCapture: vi.fn(),
    handleOcrReport: vi.fn(),
};
vi.mock('../../hooks/useDriveLogOcr', () => ({
    default: () => mockOcrReturn,
}));

const mockUser = { uid: 'testUser', displayName: '테스트', email: 'test@test.com' };
const mockUserData = { organizationId: 'org1', name: '테스트', role: 'employee' };
const mockAuthReturn = { user: mockUser, userData: mockUserData };
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => mockAuthReturn,
}));

const mockGetVehicles = vi.fn().mockResolvedValue([
    { id: 'v1', displayName: '소나타', currentKm: 50000, fuelType: 'gasoline', vehicleType: 'sedan' },
    { id: 'v2', displayName: '아이오닉5', currentKm: 30000, fuelType: 'electric', vehicleType: 'suv' },
]);
const mockCreateDriveLog = vi.fn().mockResolvedValue({ syncResult: null });
const mockUpdateDriveLog = vi.fn().mockResolvedValue({});
const mockGetFavorites = vi.fn().mockResolvedValue([]);
const mockCreateFavorite = vi.fn().mockResolvedValue({ id: 'fav1' });
const mockGetOrganizationMembers = vi.fn().mockResolvedValue([]);
const mockGetLastVehicleEndKm = vi.fn().mockResolvedValue(null);
const mockGetLastVehicleDriveLog = vi.fn().mockResolvedValue(null);
const mockGetVehicleEndKmBefore = vi.fn().mockResolvedValue(null);
const mockUpdateReservationStatus = vi.fn().mockResolvedValue({});
const mockGetReservationById = vi.fn().mockResolvedValue(null);

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    createDriveLog: (...args: unknown[]) => mockCreateDriveLog(...args),
    updateDriveLog: (...args: unknown[]) => mockUpdateDriveLog(...args),
    getFavorites: (...args: unknown[]) => mockGetFavorites(...args),
    createFavorite: (...args: unknown[]) => mockCreateFavorite(...args),
    getOrganizationMembers: (...args: unknown[]) => mockGetOrganizationMembers(...args),
    getLastVehicleEndKm: (...args: unknown[]) => mockGetLastVehicleEndKm(...args),
    getLastVehicleDriveLog: (...args: unknown[]) => mockGetLastVehicleDriveLog(...args),
    getVehicleEndKmBefore: (...args: unknown[]) => mockGetVehicleEndKmBefore(...args),
    updateReservationStatus: (...args: unknown[]) => mockUpdateReservationStatus(...args),
    getReservationById: (...args: unknown[]) => mockGetReservationById(...args),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, default: {} }));

import useDriveLogForm from '../../hooks/useDriveLogForm';

describe('useDriveLogForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 상태에서 loading이 true이다', async () => {
        const { result } = renderHook(() => useDriveLogForm());
        expect(result.current.loading).toBe(true);
        expect(result.current.submitting).toBe(false);
        expect(result.current.success).toBe(false);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('orgId가 있으면 차량 목록 및 즐겨찾기를 로드한다', async () => {
        const { result } = renderHook(() => useDriveLogForm());

        // useEffect 완료 대기
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockGetVehicles).toHaveBeenCalledWith('org1');
        expect(mockGetFavorites).toHaveBeenCalledWith('testUser');
        expect(result.current.vehicles).toHaveLength(2);
    });

    it('차량이 1개만 있으면 자동 선택된다', async () => {
        mockGetVehicles.mockResolvedValueOnce([
            { id: 'v1', displayName: '소나타', currentKm: 50000, fuelType: 'gasoline' },
        ]);

        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.form.vehicleId).toBe('v1');
        expect(result.current.form.vehicleName).toBe('소나타');
    });

    it('handleFavoriteSelect로 목적지가 채워진다', async () => {
        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.handleFavoriteSelect({ name: '서울역', address: '서울특별시 용산구' } as Parameters<typeof result.current.handleFavoriteSelect>[0]);
        });

        expect(result.current.form.destination).toBe('서울특별시 용산구');
    });

    it('togglePassenger로 동승자를 추가/제거한다', async () => {
        mockGetOrganizationMembers.mockResolvedValueOnce([
            { id: 'member1', name: '김철수' },
            { id: 'member2', name: '이영희' },
        ]);

        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // 추가
        act(() => {
            result.current.togglePassenger({ id: 'member1', name: '김철수' } as Parameters<typeof result.current.togglePassenger>[0]);
        });
        expect(result.current.selectedPassengers).toHaveLength(1);

        // 제거
        act(() => {
            result.current.togglePassenger({ id: 'member1', name: '김철수' } as Parameters<typeof result.current.togglePassenger>[0]);
        });
        expect(result.current.selectedPassengers).toHaveLength(0);
    });

    it('폼 검증 실패 시 toast를 표시한다', async () => {
        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // 차량 미선택 상태에서 제출
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => { } } as React.FormEvent);
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining('차량'),
            'warning'
        );
        expect(mockCreateDriveLog).not.toHaveBeenCalled();
    });
});
