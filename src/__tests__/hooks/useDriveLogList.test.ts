/**
 * useDriveLogList — 운행일지 목록의 조회·페이지네이션·삭제·중복 정리
 *
 * 커버리지가 0%였다. 이 훅은 관리자가 기록을 확인하고 지우는 화면의 본체라
 * 틀리면 "있는 기록이 안 보이거나, 지운 기록이 남아 있는" 상태가 된다.
 *
 * 가장 먼저 고정하는 것은 **stale 응답 폐기**다(`requestIdRef`). 필터를 빠르게 바꾸면
 * 이전 요청의 응답이 나중에 도착해 최신 목록을 덮을 수 있는데, 화면상으로는 "필터를
 * 바꿨는데 예전 결과가 보인다"로 나타나 원인을 찾기 어렵다. 경합은 테스트 없이는
 * 회귀를 알아챌 방법이 사실상 없다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockShowToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const mockConfirm = vi.fn();
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ userData: { organizationId: 'org1', role: 'admin', name: '관리자' } }),
}));

// 내보내기는 목록 상태와 독립이라 별도 훅이다 — 계약만 재현한다.
vi.mock('@/hooks/driveLogList/useDriveLogExport', () => ({
    useDriveLogExport: () => ({
        includeHipass: false, setIncludeHipass: vi.fn(),
        includePassengers: false, setIncludePassengers: vi.fn(),
        includeFuel: false, setIncludeFuel: vi.fn(),
        handleExportExcel: vi.fn(), handleExportPdf: vi.fn(),
    }),
}));

const mockGetDriveLogs = vi.fn();
const mockGetVehicles = vi.fn();
const mockGetMembers = vi.fn();
const mockGetOrganization = vi.fn();
const mockCleanupDuplicateLogs = vi.fn();
const mockDeleteDriveLog = vi.fn();
vi.mock('@/lib/firestore', () => ({
    getDriveLogs: (...a: unknown[]) => mockGetDriveLogs(...a),
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getOrganizationMembers: (...a: unknown[]) => mockGetMembers(...a),
    getOrganization: (...a: unknown[]) => mockGetOrganization(...a),
    cleanupDuplicateLogs: (...a: unknown[]) => mockCleanupDuplicateLogs(...a),
    deleteDriveLog: (...a: unknown[]) => mockDeleteDriveLog(...a),
}));

import useDriveLogList from '@/hooks/useDriveLogList';

const log = (id: string, extra: Record<string, unknown> = {}) => ({
    id, startKm: 100, endKm: 150, driverName: '홍길동', purpose: '외근', ...extra,
});

function page(docs: ReturnType<typeof log>[], hasMore = false, lastDoc: unknown = { id: 'cursor' }) {
    return { docs, hasMore, lastDoc };
}

describe('useDriveLogList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDriveLogs.mockResolvedValue(page([log('l1')]));
        mockGetVehicles.mockResolvedValue([{ id: 'v1', displayName: '스타렉스' }]);
        mockGetMembers.mockResolvedValue([
            { id: 'u1', name: '직원', role: 'employee' },
            { id: 'root', name: '개발자', role: 'superAdmin' },
        ]);
        mockGetOrganization.mockResolvedValue({ id: 'org1', name: '가나복지관' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('초기 로드에서 목록·차량·구성원·기관을 함께 가져온다', async () => {
        const { result } = renderHook(() => useDriveLogList());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.logs).toHaveLength(1);
        expect(result.current.vehicles).toHaveLength(1);
        // superAdmin(개발자 계정)은 기관 구성원 목록에서 빠진다
        expect(result.current.members.map((m) => m.id)).toEqual(['u1']);
    });

    it('이전 필터의 늦은 응답이 최신 목록을 덮지 않는다 (stale 폐기)', async () => {
        // 첫 요청은 느리게, 두 번째(필터 변경 후) 요청은 빠르게 도착시킨다.
        let releaseSlow: (v: unknown) => void = () => {};
        const slow = new Promise((res) => { releaseSlow = res; });

        mockGetDriveLogs
            .mockReturnValueOnce(slow)                              // 초기 로드 (느림)
            .mockResolvedValueOnce(page([log('fresh')]));           // 필터 변경 후 (빠름)

        const { result } = renderHook(() => useDriveLogList());

        // 필터를 바꿔 두 번째 요청을 띄운다
        await act(async () => { result.current.setFilters((f) => ({ ...f, vehicleId: 'v1' })); });
        await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['fresh']));

        // 이제 첫 요청이 뒤늦게 도착한다 — 이 결과는 버려져야 한다
        await act(async () => { releaseSlow(page([log('stale')])); await slow; });

        expect(result.current.logs.map((l) => l.id)).toEqual(['fresh']);
    });

    it('더보기는 기존 목록에 이어 붙이고 커서를 갱신한다', async () => {
        mockGetDriveLogs.mockResolvedValueOnce(page([log('l1')], true, { id: 'c1' }));
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        mockGetDriveLogs.mockResolvedValueOnce(page([log('l2')], false, { id: 'c2' }));
        await act(async () => { await result.current.loadMore(); });

        expect(result.current.logs.map((l) => l.id)).toEqual(['l1', 'l2']);
        expect(result.current.hasMore).toBe(false);
        // 두 번째 호출에 커서가 실렸다
        expect(mockGetDriveLogs).toHaveBeenLastCalledWith('org1', expect.objectContaining({ startAfter: { id: 'c1' } }));
    });

    it('더 가져올 게 없으면 더보기를 호출하지 않는다', async () => {
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.loading).toBe(false));
        mockGetDriveLogs.mockClear();

        await act(async () => { await result.current.loadMore(); });

        expect(mockGetDriveLogs).not.toHaveBeenCalled();
    });

    it('검색어는 불러온 목록 안에서만 걸러내고 총 주행거리를 다시 센다', async () => {
        mockGetDriveLogs.mockResolvedValueOnce(page([
            log('l1', { purpose: '병원 이동', endKm: 150 }),
            log('l2', { purpose: '장보기', startKm: 200, endKm: 260 }),
        ]));
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.logs).toHaveLength(2));

        expect(result.current.totalDistance).toBe(50 + 60);

        await act(async () => { result.current.setFilters((f) => ({ ...f, search: '병원' })); });

        expect(result.current.filteredLogs.map((l) => l.id)).toEqual(['l1']);
        expect(result.current.totalDistance).toBe(50);
        // 검색은 서버를 다시 부르지 않는다 (읽기 비용)
        expect(mockGetDriveLogs).toHaveBeenCalledTimes(1);
    });

    it('삭제는 확인을 받은 뒤에만 실행하고 목록에서 즉시 뺀다', async () => {
        mockGetDriveLogs.mockResolvedValueOnce(page([log('l1'), log('l2')]));
        mockConfirm.mockResolvedValue(true);
        mockDeleteDriveLog.mockResolvedValue(undefined);

        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.logs).toHaveLength(2));

        await act(async () => { await result.current.handleDelete('l1', '홍길동'); });

        expect(mockDeleteDriveLog).toHaveBeenCalledWith('l1');
        expect(result.current.logs.map((l) => l.id)).toEqual(['l2']);
        expect(mockShowToast).toHaveBeenCalledWith('운행 기록이 삭제되었습니다.', 'success');
    });

    it('삭제 확인을 취소하면 아무것도 지우지 않는다', async () => {
        mockConfirm.mockResolvedValue(false);
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.handleDelete('l1', '홍길동'); });

        expect(mockDeleteDriveLog).not.toHaveBeenCalled();
        expect(result.current.logs).toHaveLength(1);
    });

    it('중복이 없으면 검사 범위를 함께 알린다 — "없습니다"만 띄우면 전량 무결로 오해한다', async () => {
        mockCleanupDuplicateLogs.mockResolvedValue({ deleteCount: 0, duplicateGroups: 0, totalLogs: 12, scanMonths: 6 });
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.handleDupScan(); });

        expect(mockCleanupDuplicateLogs).toHaveBeenCalledWith('org1', { dryRun: true });
        expect(mockShowToast).toHaveBeenCalledWith('최근 6개월 기록에는 중복 데이터가 없습니다.', 'success');
        expect(result.current.dupState).toBe('idle');
    });

    it('중복이 있으면 결과 화면으로 넘기고, 정리는 확인 후 dryRun 없이 실행한다', async () => {
        mockCleanupDuplicateLogs.mockResolvedValueOnce({ deleteCount: 3, duplicateGroups: 1, totalLogs: 20, scanMonths: 6 });
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.handleDupScan(); });
        expect(result.current.dupState).toBe('result');
        expect(result.current.dupResult?.deleteCount).toBe(3);

        mockConfirm.mockResolvedValue(true);
        mockCleanupDuplicateLogs.mockResolvedValueOnce({ deleteCount: 3, duplicateGroups: 1, totalLogs: 17, scanMonths: 6 });
        await act(async () => { await result.current.handleDupClean(); });

        expect(mockCleanupDuplicateLogs).toHaveBeenLastCalledWith('org1', { dryRun: false });
        expect(mockShowToast).toHaveBeenCalledWith('3건의 중복 데이터가 삭제되었습니다.', 'success');
        expect(result.current.dupState).toBe('idle');
        expect(result.current.dupResult).toBeNull();
    });

    it('중복 정리가 실패하면 결과 화면으로 되돌려 다시 시도할 수 있게 한다', async () => {
        mockCleanupDuplicateLogs.mockResolvedValueOnce({ deleteCount: 2, duplicateGroups: 1, totalLogs: 9, scanMonths: 6 });
        const { result } = renderHook(() => useDriveLogList());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { await result.current.handleDupScan(); });

        mockConfirm.mockResolvedValue(true);
        mockCleanupDuplicateLogs.mockRejectedValueOnce(new Error('boom'));
        await act(async () => { await result.current.handleDupClean(); });

        expect(mockShowToast).toHaveBeenCalledWith('중복 정리에 실패했습니다.', 'error');
        expect(result.current.dupState).toBe('result'); // idle이 아니다 — 결과를 잃지 않는다
    });

    it('초기 로드가 실패해도 로딩이 풀린다 — 화면이 영원히 스피너로 남지 않게', async () => {
        mockGetDriveLogs.mockRejectedValueOnce(new Error('network'));
        const { result } = renderHook(() => useDriveLogList());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.logs).toEqual([]);
    });
});
