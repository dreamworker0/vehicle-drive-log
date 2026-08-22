/**
 * useDailyLog — 일별일지(날짜+차량) 조회와 누계 요약
 *
 * 커버리지가 0%였다. 이 훅의 요약값은 **누계 주행거리**를 만든다 — 운행일지의 숫자가
 * 그대로 기관의 대외 보고 자료가 되므로, 계산이 틀리면 기록 자체가 틀어진다.
 *
 * 특히 고정할 것:
 *  - 금일 운행거리는 **음수 구간을 버린다**(도착 km가 더 작게 잘못 들어간 옛 기록 방어)
 *  - 금일 누계는 합이 아니라 **최댓값**이다(계기판 누계는 누적합이 아니다)
 *  - 퇴역 차량은 선택 목록에 없다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ userData: { organizationId: 'org1', role: 'employee' } }),
}));

const mockGetVehicles = vi.fn();
const mockGetOrganization = vi.fn();
vi.mock('@/lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getOrganization: (...a: unknown[]) => mockGetOrganization(...a),
}));

const mockDrives = vi.fn();
const mockFuels = vi.fn();
const mockPrevKm = vi.fn();
vi.mock('@/lib/firestore/dailyLogQueries', () => ({
    getDriveLogsByDate: (...a: unknown[]) => mockDrives(...a),
    getFuelLogsByDate: (...a: unknown[]) => mockFuels(...a),
    getPreviousDayEndKm: (...a: unknown[]) => mockPrevKm(...a),
}));

import useDailyLog from '@/hooks/useDailyLog';

const vehicle = (id: string, extra: Record<string, unknown> = {}) => ({
    id, displayName: `차량${id}`, ...extra,
});

describe('useDailyLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue([vehicle('v1'), vehicle('v2')]);
        mockGetOrganization.mockResolvedValue({ id: 'org1', name: '가나복지관' });
        mockDrives.mockResolvedValue([]);
        mockFuels.mockResolvedValue([]);
        mockPrevKm.mockResolvedValue(null);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('첫 차량을 자동 선택하고 그 차량의 하루치를 조회한다', async () => {
        const { result } = renderHook(() => useDailyLog());

        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.selectedVehicleId).toBe('v1'));

        expect(result.current.selectedVehicle?.id).toBe('v1');
        expect(mockDrives).toHaveBeenCalledWith('org1', 'v1', result.current.selectedDate);
    });

    it('퇴역 차량은 선택 목록에서 제외한다', async () => {
        mockGetVehicles.mockResolvedValue([
            vehicle('old', { retired: { isRetired: true } }),
            vehicle('v1'),
        ]);
        const { result } = renderHook(() => useDailyLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.vehicles.map((v) => v.id)).toEqual(['v1']);
        // 자동 선택도 살아 있는 차량이어야 한다
        await waitFor(() => expect(result.current.selectedVehicleId).toBe('v1'));
    });

    it('금일 운행거리는 구간 합, 금일 누계는 최댓값이다', async () => {
        mockDrives.mockResolvedValue([
            { id: 'a', startKm: 1000, endKm: 1050 },  // 50
            { id: 'b', startKm: 1050, endKm: 1120 },  // 70
        ]);
        mockPrevKm.mockResolvedValue(1000);

        const { result } = renderHook(() => useDailyLog());
        await waitFor(() => expect(result.current.driveLogs).toHaveLength(2));

        expect(result.current.summary.todayDistance).toBe(120);
        // 누계는 120이 아니라 계기판 최종값 1120이다
        expect(result.current.summary.todayEndKm).toBe(1120);
        expect(result.current.summary.previousEndKm).toBe(1000);
    });

    it('음수 구간은 거리 합에서 버린다 — 잘못 입력된 옛 기록이 총계를 깎지 않게', async () => {
        mockDrives.mockResolvedValue([
            { id: 'a', startKm: 1000, endKm: 1050 },  // +50
            { id: 'b', startKm: 1200, endKm: 1100 },  // -100 → 무시
        ]);
        const { result } = renderHook(() => useDailyLog());
        await waitFor(() => expect(result.current.driveLogs).toHaveLength(2));

        expect(result.current.summary.todayDistance).toBe(50);
    });

    it('운행 기록이 없으면 금일 누계는 null이다 (0이 아니다)', async () => {
        const { result } = renderHook(() => useDailyLog());
        await waitFor(() => expect(result.current.loading).toBe(false));

        // 0으로 두면 "계기판이 0km"로 읽혀 전일 누계와 비교가 깨진다
        expect(result.current.summary.todayEndKm).toBeNull();
        expect(result.current.summary.todayDistance).toBe(0);
    });

    it('차량을 바꾸면 그 차량 기준으로 다시 조회한다', async () => {
        const { result } = renderHook(() => useDailyLog());
        await waitFor(() => expect(result.current.selectedVehicleId).toBe('v1'));
        mockDrives.mockClear();

        await act(async () => { result.current.setSelectedVehicleId('v2'); });

        await waitFor(() => expect(mockDrives).toHaveBeenCalledWith('org1', 'v2', result.current.selectedDate));
    });

    it('날짜를 바꾸면 그 날짜 기준으로 다시 조회한다', async () => {
        const { result } = renderHook(() => useDailyLog());
        await waitFor(() => expect(result.current.selectedVehicleId).toBe('v1'));
        mockDrives.mockClear();

        await act(async () => { result.current.setSelectedDate('2026-08-01'); });

        await waitFor(() => expect(mockDrives).toHaveBeenCalledWith('org1', 'v1', '2026-08-01'));
        // 주유 기록과 전일 누계도 같은 기준으로 함께 갱신된다
        expect(mockFuels).toHaveBeenCalledWith('org1', 'v1', '2026-08-01');
        expect(mockPrevKm).toHaveBeenCalledWith('org1', 'v1', '2026-08-01');
    });

    it('차량이 없으면 하루치 조회를 시도하지 않는다', async () => {
        mockGetVehicles.mockResolvedValue([]);
        const { result } = renderHook(() => useDailyLog());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.selectedVehicleId).toBe('');
        expect(mockDrives).not.toHaveBeenCalled();
    });

    it('조회가 실패해도 로딩이 풀린다 — 화면이 스피너로 남지 않게', async () => {
        mockDrives.mockRejectedValue(new Error('network'));
        const { result } = renderHook(() => useDailyLog());

        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.loadingData).toBe(false));
        expect(result.current.driveLogs).toEqual([]);
    });

    it('차량 목록 로드가 실패해도 로딩이 풀린다', async () => {
        mockGetVehicles.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useDailyLog());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.vehicles).toEqual([]);
    });
});
