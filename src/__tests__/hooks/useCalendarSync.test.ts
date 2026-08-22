/**
 * useCalendarSync — 온디맨드 캘린더 동기화 훅
 *
 * 이 훅은 예약 캘린더를 열 때마다 백그라운드로 콜러블을 부른다. 그래서 "실패했을 때
 * 몇 번 더 부르는가"가 곧 비용이다. 서버가 호출 빈도 상한으로 건너뛴 응답
 * (errorType "rate-limited")에 대해 재시도하면 상한만 더 소모하므로, 그 경우
 * **재시도 없이 멈추고 쿨다운을 적용**하는 것을 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mockCallable,
}));
vi.mock('@/lib/firebase', () => ({ firebaseFunctions: {} }));

import { useCalendarSync } from '@/hooks/useCalendarSync';

const STORAGE_KEY = 'last_calendar_sync_time_map';

describe('useCalendarSync — syncVehicleOnDemand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('성공하면 true를 돌려주고 쿨다운을 기록한다', async () => {
        mockCallable.mockResolvedValue({ data: { success: true } });
        const { result } = renderHook(() => useCalendarSync());

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });

        expect(ok).toBe(true);
        expect(mockCallable).toHaveBeenCalledTimes(1);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveProperty('veh-1');
    });

    it('rate-limited 응답은 재시도하지 않는다 — 재시도하면 서버 상한만 더 소모한다', async () => {
        mockCallable.mockResolvedValue({
            data: { success: false, errorType: 'rate-limited', message: '최근에 동기화했습니다.' },
        });
        const { result } = renderHook(() => useCalendarSync());

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });

        expect(ok).toBe(false);
        expect(mockCallable).toHaveBeenCalledTimes(1);          // 3회가 아니라 1회
        expect(result.current.loading).toBe(false);
    });

    it('rate-limited는 쿨다운을 적용해 다음 호출 자체를 막는다', async () => {
        mockCallable.mockResolvedValue({
            data: { success: false, errorType: 'rate-limited' },
        });
        const { result } = renderHook(() => useCalendarSync());

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });
        expect(mockCallable).toHaveBeenCalledTimes(1);

        // 두 번째 호출은 쿨다운에서 걸러져 콜러블에 닿지 않는다
        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });
        expect(mockCallable).toHaveBeenCalledTimes(1);
    });

    it('rate-limited는 오류가 아니다 — error 상태를 세우지 않는다', async () => {
        mockCallable.mockResolvedValue({
            data: { success: false, errorType: 'rate-limited' },
        });
        const { result } = renderHook(() => useCalendarSync());

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });

        // 자동 호출 경로라 사용자에게 보일 이유가 없다
        expect(result.current.error).toBeNull();
    });

    it('calendar-not-found도 재시도하지 않는다 (기존 동작 유지)', async () => {
        mockCallable.mockResolvedValue({
            data: { success: false, errorType: 'calendar-not-found', message: '연동 안 됨' },
        });
        const { result } = renderHook(() => useCalendarSync());

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });

        expect(mockCallable).toHaveBeenCalledTimes(1);
        expect(result.current.error).toBe('연동 안 됨');
    });

    it('force는 클라이언트 쿨다운을 우회한다 — 서버 상한이 최종 방어선이다', async () => {
        mockCallable.mockResolvedValue({ data: { success: true } });
        const { result } = renderHook(() => useCalendarSync());

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });
        // 쿨다운 중이지만 force로 다시 부른다
        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1', { force: true }); });

        expect(mockCallable).toHaveBeenCalledTimes(2);
    });
});
