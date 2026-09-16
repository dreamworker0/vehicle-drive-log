import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 예약 폼의 종료시간을 **누가 소유하는가**를 고정한다.
 *
 * 경로 소요시간이 도착할 때마다 종료시간을 무조건 덮어써서, 수정 화면을 열기만 해도 저장돼
 * 있던 시간이 조용히 바뀌었다(2026-09-16 이용 기관 신고 2건 — 전화 1건·게시판 1건).
 * 목적지가 이미 채워져 있으니 경로 조회가 돌고, 1.2초 뒤 결과가 오면서 갈아치운 것이다.
 *
 * 회귀 지점은 **양쪽**이다 — 사람이 정한 값을 덮는 것(신고)과, 반대로 신규 작성에서 자동
 * 계산이 영영 돌지 않게 되는 것(이 수정이 잘못될 때의 모습).
 */

const mockGetMultiRouteWithFreeRoad = vi.fn();
vi.mock('../../lib/tmap', () => ({
    getMultiRouteWithFreeRoad: (...args: unknown[]) => mockGetMultiRouteWithFreeRoad(...args),
    getFreeRoadRoute: vi.fn().mockResolvedValue(null),
    isTmapAvailable: vi.fn().mockReturnValue(true),
    VEHICLE_TYPE_TO_CAR_TYPE: { sedan: '1' },
}));

vi.mock('../../lib/orgSites', () => ({
    resolveDepartureAddress: vi.fn().mockReturnValue('서울시 용산구'),
    resolveVehicleSite: vi.fn().mockReturnValue({ name: '본관' }),
    hasBranchSites: vi.fn().mockReturnValue(false),
}));

import { useRouteInfo } from '../../hooks/reservationCalendar/useRouteInfo';
import type { ReservationForm } from '../../types/reservation';
import type { Vehicle } from '../../types/vehicle';

const VEHICLES = [{ id: 'v1', displayName: '소나타', vehicleType: 'sedan' }] as unknown as Vehicle[];

/** 편도 30분 — calcEndTime은 (30*2)+60 = 120분을 더한다 */
const ROUTE_30MIN = { distance: 25, duration: 30, tollFee: 0, hasToll: false };

function baseForm(over: Partial<ReservationForm> = {}): ReservationForm {
    return {
        vehicleId: 'v1',
        destination: '서울시청',
        purpose: '업무',
        startTime: '09:00',
        endTime: '10:00',
        ...over,
    } as ReservationForm;
}

interface Props { form: ReservationForm; endTimeTouched: boolean }

function setup(props: Props) {
    const setForm = vi.fn();
    const view = renderHook(
        ({ form, endTimeTouched }: Props) => useRouteInfo({
            form, setForm, orgAddress: '서울시 용산구', orgSites: [], vehicles: VEHICLES, endTimeTouched,
        }),
        { initialProps: props },
    );
    return { ...view, setForm };
}

/** 디바운스(1.2초)를 넘기고 TMAP 응답까지 흘린다 */
async function flushRoute() {
    await act(async () => {
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
        await Promise.resolve();
    });
}

/**
 * setForm(updater)에 실린 endTime을 꺼낸다 — 마지막 호출 기준.
 *
 * updater에 **그 시점의 실제 폼**을 넣는다. 합성 폼을 넣으면 지금은 우연히 맞지만(updater가
 * prev를 무시하고 endTime을 무조건 쓴다) "기존 값이 더 늦으면 유지" 같은 prev 의존 규칙이
 * 들어오는 순간 거짓 통과한다.
 */
function lastEndTime(setForm: ReturnType<typeof vi.fn>, currentForm: ReservationForm): string | undefined {
    const calls = setForm.mock.calls;
    if (calls.length === 0) return undefined;
    const call = calls[calls.length - 1];
    const updater = call[0] as (prev: ReservationForm) => ReservationForm;
    return updater(currentForm).endTime;
}

describe('useRouteInfo — 종료시간 자동 계산', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockGetMultiRouteWithFreeRoad.mockResolvedValue(ROUTE_30MIN);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('사람이 정하지 않은 종료시간은 경로 기준으로 채운다', async () => {
        const form = baseForm();
        const { setForm } = setup({ form, endTimeTouched: false });
        await flushRoute();

        // 09:00 + (30분 × 2) + 여유 1시간 = 11:00
        expect(lastEndTime(setForm, form)).toBe('11:00');
    });

    it('사람이 정한 종료시간은 덮지 않는다 — 수정 화면을 열기만 해도 바뀌던 자리', async () => {
        const { setForm } = setup({ form: baseForm({ endTime: '18:00' }), endTimeTouched: true });
        await flushRoute();

        expect(setForm).not.toHaveBeenCalled();
    });

    it('덮는 대신 제안한다 — 사람이 정한 값과 계산값이 어긋날 때만', async () => {
        const { result } = setup({ form: baseForm({ endTime: '18:00' }), endTimeTouched: true });
        await flushRoute();

        expect(result.current.suggestedEndTime).toBe('11:00');
    });

    it('자동으로 채운 뒤에는 제안하지 않는다 — 보여 줄 것이 없다', async () => {
        // 폼이 이미 계산값을 담고 있는 상태(자동 채움 직후의 모습)
        const { result } = setup({ form: baseForm({ endTime: '11:00' }), endTimeTouched: false });
        await flushRoute();

        expect(result.current.suggestedEndTime).toBeNull();
    });

    it('다일 예약은 채우지도 제안하지도 않는다 — 3일 예약이 하루로 줄던 자리', async () => {
        // 종료시간 칸이 **마지막 날의 종료**를 담는데 계산은 첫날 시작 기준이라 뜻이 다르다.
        const { result, setForm } = setup({
            form: baseForm({ endDate: '2026-09-18', endTime: '18:00' }),
            endTimeTouched: false,
        });
        await flushRoute();

        expect(setForm).not.toHaveBeenCalled();
        expect(result.current.suggestedEndTime).toBeNull();
    });

    it('반복 예약은 제외하지 않는다 — 회차마다 그날 안에 끝나므로 단건과 뜻이 같다', async () => {
        // 처음에는 다일과 함께 뺐는데 근거가 틀렸다(머지 전 리뷰). 빼 두면 반복 예약을 만들 때
        // 자동 계산 편의만 이유 없이 사라진다.
        const form = baseForm({ isRecurring: true, endTime: '18:00' });
        const { setForm } = setup({ form, endTimeTouched: false });
        await flushRoute();

        expect(lastEndTime(setForm, form)).toBe('11:00');
    });

    it('잠금이 풀리면 다시 채운다 — 리셋 후 신규 작성이 막히면 안 된다', async () => {
        const { setForm, rerender } = setup({ form: baseForm({ endTime: '18:00' }), endTimeTouched: true });
        await flushRoute();
        expect(setForm).not.toHaveBeenCalled();

        const unlocked = baseForm({ endTime: '18:00' });
        await act(async () => {
            rerender({ form: unlocked, endTimeTouched: false });
        });

        expect(lastEndTime(setForm, unlocked)).toBe('11:00');
    });

    it('목적지가 바뀌면 옛 경로 결과를 제안 근거로 쓰지 않는다', async () => {
        const { result, rerender } = setup({ form: baseForm({ endTime: '18:00' }), endTimeTouched: true });
        await flushRoute();
        expect(result.current.routeInfo).not.toBeNull();

        // 새 목적지의 조회가 끝나기 전 — 옛 소요시간이 남아 있으면 그것으로 제안하게 된다.
        mockGetMultiRouteWithFreeRoad.mockImplementation(() => new Promise(() => { }));
        await act(async () => {
            rerender({ form: baseForm({ destination: '부산시청', endTime: '18:00' }), endTimeTouched: true });
        });

        expect(result.current.routeInfo).toBeNull();
        expect(result.current.suggestedEndTime).toBeNull();
    });

    it('경로를 못 구하면 아무것도 하지 않는다', async () => {
        mockGetMultiRouteWithFreeRoad.mockResolvedValue(null);
        const { result, setForm } = setup({ form: baseForm(), endTimeTouched: false });
        await flushRoute();

        expect(setForm).not.toHaveBeenCalled();
        expect(result.current.suggestedEndTime).toBeNull();
    });
});
