/**
 * useReservationData — 공휴일 로드가 화면을 막지 않는지 검증
 *
 * 회귀 대상: 공휴일 조회(getHolidays)가 초기 로드 Promise.all 안에 있어서,
 * Firestore에 해당 연도 공휴일이 없을 때 외부 공공데이터 API 응답이 늦으면
 * 예약 화면이 영구 스피너가 되던 결함(Phase 122 부수 발견).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGetHolidays = vi.fn();
const mockGetVehicles = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getFavorites: vi.fn().mockResolvedValue([]),
    getReservationsByDateRange: vi.fn().mockResolvedValue([]),
    getOrganizationMembers: vi.fn().mockResolvedValue([]),
    getOrganization: vi.fn().mockResolvedValue({ id: 'org1', address: '서울시 용산구' }),
}));
vi.mock('../../lib/holiday', () => ({
    getHolidays: (...args: unknown[]) => mockGetHolidays(...args),
}));
vi.mock('../../lib/firebase', () => ({ db: {}, default: {} }));
vi.mock('../../hooks/useCalendarSync', () => ({
    useCalendarSync: () => ({
        syncVehicleOnDemand: vi.fn(),
        checkCooldown: vi.fn().mockReturnValue(true),
        getLastSyncTime: vi.fn().mockReturnValue(null),
    }),
}));

import { useReservationData } from '../../hooks/reservationCalendar/useReservationData';

const params = {
    user: { uid: 'u1' },
    userData: { organizationId: 'org1', name: '테스트' },
    isAdmin: false,
    showToast: mockShowToast,
    currentMonth: new Date('2026-08-01T00:00:00+09:00'),
};

describe('useReservationData — 공휴일 비차단 로드', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue([{ id: 'v1', displayName: '스타렉스' }]);
        mockGetHolidays.mockResolvedValue([]);
    });

    it('공휴일 조회가 끝나지 않아도 loading이 해제된다 (무한 스피너 방지)', async () => {
        // 외부 API가 응답하지 않는 상황 — 영원히 pending인 Promise
        mockGetHolidays.mockReturnValue(new Promise(() => { }));

        const { result } = renderHook(() => useReservationData(params));

        await waitFor(() => expect(result.current.loading).toBe(false));
        // 화면에 필요한 나머지 데이터는 정상적으로 채워져 있어야 한다
        expect(result.current.vehicles).toHaveLength(1);
    });

    it('공휴일 조회가 실패해도 loading이 해제되고 오류 토스트를 띄우지 않는다', async () => {
        mockGetHolidays.mockRejectedValue(new Error('공공데이터 API 500'));

        const { result } = renderHook(() => useReservationData(params));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.holidays).toEqual([]);
        // 공휴일 표시가 빠질 뿐 예약 기능에는 영향이 없으므로 사용자를 놀래키지 않는다
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('늦게 도착한 공휴일도 반영된다', async () => {
        let resolveHolidays: (v: unknown) => void = () => { };
        mockGetHolidays.mockReturnValue(new Promise((res) => { resolveHolidays = res; }));

        const { result } = renderHook(() => useReservationData(params));

        // 공휴일보다 먼저 화면이 열린다
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.holidays).toEqual([]);

        resolveHolidays([{ date: '2026-08-15', name: '광복절' }]);

        await waitFor(() => expect(result.current.holidays).toHaveLength(1));
        expect(result.current.holidays[0].name).toBe('광복절');
    });

    it('차량 조회가 실패하면 기존대로 오류 토스트를 띄운다 (대조군)', async () => {
        mockGetVehicles.mockRejectedValue(new Error('permission-denied'));

        const { result } = renderHook(() => useReservationData(params));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockShowToast).toHaveBeenCalledWith('데이터를 불러오는데 실패했습니다.', 'error');
    });
});
