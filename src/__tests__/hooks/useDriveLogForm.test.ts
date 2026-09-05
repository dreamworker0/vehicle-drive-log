import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOrgSites } from '../../lib/orgSites';
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
const mockAuthReturn = { user: mockUser, userData: mockUserData, orgSites: resolveOrgSites(null) };
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

    it('주소 없이 별칭만 저장된 즐겨찾기를 골라도 목적지가 undefined가 되지 않는다', async () => {
        // 즐겨찾기 관리 화면은 주소 없이(address='') 저장하고 destination 필드를 남기지 않는다.
        // 예전에는 그 값이 그대로 폼에 들어가 다음 렌더의 trim()에서 화면이 죽었다.
        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.handleFavoriteSelect({ name: '김OO 어르신 댁', address: '' } as Parameters<typeof result.current.handleFavoriteSelect>[0]);
        });

        expect(result.current.form.destination).toBe('김OO 어르신 댁');
    });

    it('별칭·주소가 모두 빈 즐겨찾기를 골라도 목적지는 빈 문자열이다', async () => {
        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.handleFavoriteSelect({} as Parameters<typeof result.current.handleFavoriteSelect>[0]);
        });

        expect(result.current.form.destination).toBe('');
    });

    // 저장 모양은 네 화면이 공유한다 — 운행일지 폼만 destination에 넣고 address를 비워 두던 탓에
    // 즐겨찾기 관리 화면·예약 폼에서 읽던 주소가 비어 보였다. 정규화는 createFavorite이 한다.
    it('handleSaveFavorite은 별칭과 주소를 함께 넘긴다', async () => {
        const { result } = renderHook(() => useDriveLogForm());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.setForm(prev => ({ ...prev, destination: '  서울시청  ' }));
        });
        await act(async () => {
            await result.current.handleSaveFavorite();
        });

        expect(mockCreateFavorite).toHaveBeenCalledWith(expect.objectContaining({
            name: '서울시청',
            address: '서울시청',
        }));
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

    it('소급 판정은 **도착일** 기준이다 — 어제 나가 오늘 돌아온 운행은 오늘 것이다', async () => {
        // 출발일로 재면 1박2일 운행이 소급으로 분류되어, 오늘 끝난 운행인데도 하이패스·주유
        // 입력칸이 사라지고 서버 트리거가 차량 km·세운 곳 갱신을 건너뛴다.
        const { result } = renderHook(() => useDriveLogForm());
        await waitFor(() => { expect(result.current.loading).toBe(false); });

        const today = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const y = new Date(today.getTime() - 86400000);
        const yesterdayStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

        await act(async () => {
            result.current.setForm(prev => ({ ...prev, driveDate: yesterdayStr, endDate: todayStr }));
        });

        expect(result.current.isRetroactive).toBe(false);

        // 도착일까지 어제면 그때는 진짜 소급이다
        await act(async () => {
            result.current.setForm(prev => ({ ...prev, endDate: yesterdayStr }));
        });

        expect(result.current.isRetroactive).toBe(true);
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
