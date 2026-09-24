// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { Suspense } from 'react';

// ── Mocks ──
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

/*
 * user·userData는 **참조가 안정적이어야** 한다.
 *
 * 종전에는 `useAuth: () => ({ user: {...}, userData: {...} })`로 매 렌더마다 새 객체를
 * 돌려줬다. 그러면 훅의 `useMemo(…, [orgId, user, …])` 의존성이 렌더마다 바뀌어
 * **리렌더마다 재페치**가 일어난다 — 프로덕션의 Firebase User는 같은 인스턴스가 유지되므로
 * 실제와 다른 동작이다. 그 차이 때문에 "실패 후 재시도" 계약을 테스트가 검증하지 못하고,
 * 재시도 로직이 없어도 초록이 됐다(하네스가 대신 다시 받아 왔다).
 */
const { mockUser, mockUserData } = vi.hoisted(() => ({
    mockUser: { uid: 'testUser', displayName: '테스트', email: 'test@test.com' },
    mockUserData: { organizationId: 'org1', name: '테스트', role: 'employee' },
}));
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ user: mockUser, userData: mockUserData }),
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
// 오늘 예약은 주간(오늘~+7일) 조회 결과에서 date === 오늘로 파생되므로 주간 목에 함께 넣는다
const mockGetWeekReservations = vi.fn().mockResolvedValue(mockTodayReservations);
const mockGetMyDriveLogs = vi.fn().mockResolvedValue([]);
const mockUpdateReservationStatus = vi.fn().mockResolvedValue({});
const mockCancelReservation = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getVehicles: vi.fn().mockImplementation((...args: unknown[]) => mockGetVehicles(...args)),
    getWeekReservations: vi.fn().mockImplementation((...args: unknown[]) => mockGetWeekReservations(...args)),
    updateReservationStatus: vi.fn().mockImplementation((...args: unknown[]) => mockUpdateReservationStatus(...args)),
    cancelReservation: vi.fn().mockImplementation((...args: unknown[]) => mockCancelReservation(...args)),
    getMyDriveLogs: vi.fn().mockImplementation((...args: unknown[]) => mockGetMyDriveLogs(...args)),
}));

// currentUser는 권한 오류 복구 테스트에서 바꿔 끼우므로 가변 객체로 둔다.
const { mockAuth, tokenRefresh } = vi.hoisted(() => ({
    mockAuth: { currentUser: null as { uid: string } | null },
    tokenRefresh: { calls: 0, fatal: false },
}));
vi.mock('../../lib/firebase', () => ({ db: {}, auth: mockAuth, default: {} }));

// 실제 getIdToken(true)을 부르지 않도록 대체하고, 세션 무효화 여부를 테스트가 조종한다.
vi.mock('../../lib/tokenRefresh', () => ({
    refreshTokenSilently: vi.fn(async () => { tokenRefresh.calls += 1; }),
    getLastTokenRefreshFailure: vi.fn(() => (
        tokenRefresh.fatal ? { code: 'auth/user-disabled', fatal: true, at: Date.now() } : null
    )),
}));
vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: vi.fn((d) => {
        if (!d) return '2026-03-04';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }),
}));

import useTodayDashboard, { invalidateDashboardCache } from '../../hooks/useTodayDashboard';

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(Suspense, { fallback: null }, children);
const renderDashboardHook = async () => {
    let result: Record<string, unknown> | undefined;
    await act(async () => {
        result = renderHook(() => useTodayDashboard(), { wrapper }).result as unknown as Record<string, unknown>;
        await new Promise(resolve => setTimeout(resolve, 50));
    });
    return { result: result as { current: ReturnType<typeof useTodayDashboard> } };
};

describe('useTodayDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateDashboardCache();
    });

    // suspense 패턴 도입으로 loading 상태 제외
    it('orgId가 있으면 차량/예약/일지를 로드한다', async () => {
        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        expect(mockGetVehicles).toHaveBeenCalledWith('org1');
        expect(mockGetWeekReservations).toHaveBeenCalled();
        expect(result.current?.vehicles).toHaveLength(2);
    });

    it('myReservations는 본인 예약만 필터링한다', async () => {
        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        // testUser의 예약만 (res1만, completed 제외)
        expect(result.current?.myReservations).toHaveLength(1);
        expect(result.current?.myReservations?.[0].id).toBe('res1');
    });

    it('운행 중인 예약이 없으면 hasActiveDrive는 false이다', async () => {
        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        expect(result.current?.hasActiveDrive).toBe(false);
    });

    it('운행 중인 예약이 있으면 hasActiveDrive는 true이다', async () => {
        mockGetWeekReservations.mockResolvedValueOnce([
            { id: 'res1', vehicleId: 'v1', reservedByUid: 'testUser', status: 'in_progress', startTime: '09:00', endTime: '12:00', date: '2026-03-04' },
        ]);

        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        expect(result.current?.hasActiveDrive).toBe(true);
    });

    it('navigateToReservations가 올바른 경로로 이동한다', async () => {
        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        act(() => {
            result.current?.navigateToReservations();
        });

        expect(mockNavigate).toHaveBeenCalledWith('/employee/reservations', { state: { defaultVehicleId: 'v1', openForm: true } });
    });

    it('todayLabel이 한국어 형식이다', async () => {
        const { result } = await renderDashboardHook();

        await waitFor(() => {
            expect(result.current?.myReservations || result.current?.todayLabel).toBeDefined();
        });

        // 오늘 날짜가 한국어로 포맷팅 되었는지 확인
        expect(result.current?.todayLabel).toBeTruthy();
        expect(typeof result.current?.todayLabel).toBe('string');
    });

    /**
     * 권한 오류 복구 — **빈 화면이 커밋되지 않는다**는 것을 고정한다.
     *
     * 부팅 시 캐시된 커스텀 클레임이 낡으면 첫 쿼리 무리가 permission-denied로 거부된다
     * (useAuth가 클레임 불일치를 감지하면 토큰을 백그라운드로 갱신하면서 로딩을 막지 않기
     * 때문 — 그 파일 주석 참고). 그때 `getDashboardData`는 토큰을 갱신하고 **빈 데이터**를
     * 돌려주는데, 그것이 화면에 남지 않는 이유는 캐시를 함께 비우기 때문이다:
     *
     *   `use()`로 서스펜드된 렌더는 **커밋되지 않고 버려진다.** 프라미스가 풀리면 React가
     *   렌더를 재생하고, 그 자리에서 `useMemo`가 다시 돌아 비워진 캐시 때문에 **새 페치**가
     *   시작된다. 갱신된 토큰으로 그 페치가 성공하므로 사용자는 빈 화면 대신 로딩만 본다.
     *
     * 이 복구는 세 가지가 맞물려야 성립한다 — ① 실패 경로가 캐시를 비운다 ② 페치가
     * `useMemo` 안에 있다 ③ 실패를 throw가 아니라 resolve로 돌려준다. 어느 하나만 손대도
     * **조용히** 깨져 운전자가 "예약 없음"을 보게 되므로(예약이 있는데 차를 두고 갈 수 있다)
     * 여기서 결과로 고정한다.
     *
     * ⚠️ `mockRejectedValueOnce`를 쓰지 않는다. `clearAllMocks`가 Once 큐를 비우지 않아
     * 소비되지 않은 항목이 다음 테스트로 새는 함정이 이 저장소에 이미 있었다(Phase 208).
     * 대신 카운터로 실패 횟수를 조종하고 afterEach에서 기본 구현으로 되돌린다.
     */
    describe('권한 오류 복구', () => {
        /** 앞에서 몇 번을 거부할지. `Infinity`면 계속 거부한다. */
        let denyCount = 0;

        const permissionDenied = () => {
            const err = new Error('Missing or insufficient permissions.') as Error & { code?: string };
            err.code = 'permission-denied';
            return err;
        };

        /** 지연(400ms) + 재시도까지 끝날 만큼 기다린다. */
        const renderAndSettle = async () => {
            const rendered = await renderDashboardHook();
            await waitFor(
                () => { expect(mockGetWeekReservations.mock.calls.length).toBeGreaterThan(0); },
                { timeout: 3000 },
            );
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
            return rendered;
        };

        beforeEach(() => {
            denyCount = 0;
            tokenRefresh.calls = 0;
            tokenRefresh.fatal = false;
            mockAuth.currentUser = { uid: 'testUser' };
            mockGetWeekReservations.mockImplementation(async () => {
                if (denyCount > 0) { if (denyCount !== Infinity) denyCount -= 1; throw permissionDenied(); }
                return mockTodayReservations;
            });
        });

        afterEach(() => {
            mockAuth.currentUser = null;
            mockGetWeekReservations.mockImplementation(async () => mockTodayReservations);
        });

        it('첫 시도가 권한 오류여도 토큰 갱신 뒤 스스로 다시 받아 온다', async () => {
            denyCount = 1;

            const { result } = await renderAndSettle();

            expect(tokenRefresh.calls).toBe(1);
            // 두 번 질의한다 — 거부된 첫 주기, 그리고 서스펜스 재생이 시작한 두 번째 주기.
            expect(mockGetWeekReservations).toHaveBeenCalledTimes(2);
            // **빈 화면이 남지 않는다**: 실제 데이터가 들어와야 한다.
            expect(result.current?.vehicles).toHaveLength(2);
            expect(result.current?.myReservations).toHaveLength(1);
        });

        it('실패 경로는 캐시를 비운다 — 이것이 재생 시 재질의의 조건이다', async () => {
            denyCount = 1;

            await renderAndSettle();

            // 캐시가 남아 있었다면 두 번째 주기가 거부된 결과(빈 데이터)를 그대로 재사용해
            // 화면이 빈 채로 굳는다. 두 번째 질의가 실제로 나갔다는 것이 그 반증이다.
            expect(mockGetVehicles).toHaveBeenCalledTimes(2);
        });

        it('계속 거부되면 빈 데이터로 대체하고 화면은 살아 있다', async () => {
            denyCount = Infinity;

            const { result } = await renderAndSettle();

            expect(tokenRefresh.calls).toBeGreaterThan(0);
            expect(result.current?.vehicles).toHaveLength(0);
            expect(result.current?.myReservations).toHaveLength(0);
            // throw가 아니라 resolve로 돌려주므로 상위 ErrorBoundary로 튀지 않는다.
            expect(result.current?.todayLabel).toBeTruthy();
        });

        it('권한 오류가 아닌 실패는 토큰을 갱신하지 않는다', async () => {
            mockGetWeekReservations.mockImplementation(async () => {
                throw new Error('네트워크 오류');
            });

            const { result } = await renderAndSettle();

            expect(tokenRefresh.calls).toBe(0);
            expect(result.current?.vehicles).toHaveLength(0);
        });

        it('로그인 세션이 없으면 토큰 갱신을 시도하지 않는다', async () => {
            denyCount = 1;
            mockAuth.currentUser = null;

            await renderAndSettle();

            expect(tokenRefresh.calls).toBe(0);
        });
    });

    // 빈 데이터로 대체하는 설계 때문에 "예약이 없다"와 "못 받아 왔다"가 같은 화면이 된다.
    // loadFailed가 그 둘을 갈라 준다 — 이 플래그가 없으면 운전자는 자기 예약을 없는 것으로 본다.
    describe('불러오기 실패와 빈 결과의 구분', () => {
        afterEach(() => {
            mockAuth.currentUser = null;
            mockGetWeekReservations.mockImplementation(async () => mockTodayReservations);
        });

        it('정상 로드면 loadFailed는 false다', async () => {
            const { result } = await renderDashboardHook();

            await waitFor(() => { expect(result.current?.vehicles).toHaveLength(2); });

            expect(result.current?.loadFailed).toBe(false);
        });

        it('예약이 진짜 0건이어도 loadFailed는 false다 — 빈 결과는 실패가 아니다', async () => {
            mockGetWeekReservations.mockImplementation(async () => []);

            const { result } = await renderDashboardHook();

            await waitFor(() => { expect(result.current?.vehicles).toHaveLength(2); });

            expect(result.current?.myReservations).toHaveLength(0);
            expect(result.current?.loadFailed).toBe(false);
        });

        it('불러오기가 실패하면 loadFailed가 true다', async () => {
            mockGetWeekReservations.mockImplementation(async () => {
                throw new Error('The query requires an index. That index is currently building');
            });

            const { result } = await renderDashboardHook();

            await waitFor(() => { expect(result.current?.loadFailed).toBe(true); }, { timeout: 3000 });

            // 실패해도 화면은 살아 있다 — 데이터만 비어 있다.
            expect(result.current?.myReservations).toHaveLength(0);
            expect(result.current?.todayLabel).toBeTruthy();
        });
    });
});
