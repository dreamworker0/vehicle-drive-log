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

import { useCalendarSync, lastScheduledCalendarSyncAt } from '@/hooks/useCalendarSync';

const STORAGE_KEY = 'last_calendar_sync_time_map';
/** KST 시각 → epoch ms */
const kst = (iso: string) => new Date(iso + '+09:00').getTime();
/** 정기 동기화가 쉬는 시각(토요일) — 자동 호출 경로를 검사하는 테스트의 기준 시각 */
const SATURDAY_NOON = kst('2026-10-31T12:00:00');

describe('useCalendarSync — syncVehicleOnDemand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(SATURDAY_NOON);
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

    // 6E "Consecutive HTTP": 재시도까지 다 실패하면 쿨다운이 없어 화면을 열 때마다 3회씩 다시 불렀다
    it('재시도까지 모두 실패해도 쿨다운을 걸어 다음 화면 진입에서 다시 부르지 않는다', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(SATURDAY_NOON);
        mockCallable.mockRejectedValue(new Error('internal'));
        const { result } = renderHook(() => useCalendarSync());

        let ok: boolean | undefined;
        await act(async () => {
            const pending = result.current.syncVehicleOnDemand('veh-1', 'org-1');
            await vi.runAllTimersAsync();   // 2초·4초 백오프
            ok = await pending;
        });
        expect(ok).toBe(false);
        expect(mockCallable).toHaveBeenCalledTimes(3);
        expect(result.current.checkCooldown('veh-1')).toBe(false);

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });
        expect(mockCallable).toHaveBeenCalledTimes(3);
    });

    it('같은 차량을 동시에 부르면 요청은 한 번만 나가고 결과를 함께 받는다 (화면 두 곳·effect 재실행)', async () => {
        let resolve: (v: unknown) => void = () => {};
        mockCallable.mockImplementation(() => new Promise((r) => { resolve = r; }));
        const home = renderHook(() => useCalendarSync());
        const calendar = renderHook(() => useCalendarSync());

        let results: boolean[] = [];
        await act(async () => {
            const both = Promise.all([
                home.result.current.syncVehicleOnDemand('veh-1', 'org-1'),
                calendar.result.current.syncVehicleOnDemand('veh-1', 'org-1', { force: true }),
            ]);
            resolve({ data: { success: true } });
            results = await both;
        });

        expect(mockCallable).toHaveBeenCalledTimes(1);
        expect(results).toEqual([true, true]);
    });
});

describe('정기 동기화 시간에는 자동 호출을 하지 않는다', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        // [지금(KST), 기대하는 회차(KST) 또는 null]
        ['2026-10-26T10:32:00', '2026-10-26T10:00:00'],   // 월요일 낮 — 직전 회차
        ['2026-10-26T10:36:00', '2026-10-26T10:30:00'],   // 회차 시작 5분 뒤부터 그 회차
        ['2026-10-26T10:33:00', '2026-10-26T10:00:00'],   // 10:30 회차는 아직 도는 중일 수 있다
        ['2026-10-26T06:05:00', '2026-10-26T06:00:00'],   // 첫 회차가 끝난 뒤
        ['2026-10-26T06:03:00', null],                    // 첫 회차 전 — 전날 밤 변경분이 남아 있다
        ['2026-10-26T05:50:00', null],                    // 새벽
        ['2026-10-30T23:00:00', '2026-10-30T22:30:00'],   // 금요일 마지막 회차
        ['2026-10-30T23:05:00', null],                    // 마지막 회차의 유효 시간이 지남
        ['2026-10-31T12:00:00', null],                    // 토요일
        ['2026-11-01T12:00:00', null],                    // 일요일
        ['2026-11-02T00:10:00', null],                    // 월요일 자정 직후
    ])('%s → %s', (now, expected) => {
        expect(lastScheduledCalendarSyncAt(kst(now))).toBe(expected === null ? null : kst(expected));
    });

    it('평일 낮에는 쿨다운이 비어 있어도 자동 호출하지 않는다', async () => {
        vi.setSystemTime(kst('2026-10-26T10:40:00'));
        mockCallable.mockResolvedValue({ data: { success: true } });
        const { result } = renderHook(() => useCalendarSync());

        expect(result.current.checkCooldown('veh-1')).toBe(false);
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.syncVehicleOnDemand('veh-1', 'org-1'); });

        expect(ok).toBe(false);
        expect(mockCallable).not.toHaveBeenCalled();
    });

    it('평일 낮에도 수동 "지금 동기화"(force)는 부른다', async () => {
        vi.setSystemTime(kst('2026-10-26T10:40:00'));
        mockCallable.mockResolvedValue({ data: { success: true } });
        const { result } = renderHook(() => useCalendarSync());

        await act(async () => { await result.current.syncVehicleOnDemand('veh-1', 'org-1', { force: true }); });

        expect(mockCallable).toHaveBeenCalledTimes(1);
    });

    it('마지막 동기화 시각에 정기 회차를 반영한다 — 자동 호출이 없어도 표시가 낡지 않게', () => {
        vi.setSystemTime(kst('2026-10-26T10:40:00'));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'veh-1': kst('2026-10-26T08:00:00') }));
        const { result } = renderHook(() => useCalendarSync());

        expect(result.current.getLastSyncTime(['veh-1'])).toBe(kst('2026-10-26T10:30:00'));
        // 연동 차량이 없으면 동기화한 것이 없다
        expect(result.current.getLastSyncTime([])).toBeNull();
    });
});
