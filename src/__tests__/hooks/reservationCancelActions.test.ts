/**
 * handleCancel — 다일 예약 그룹 취소
 *
 * 고정하는 계약: **취소되지 않았으면 취소된 것처럼 보이지 않는다.**
 *
 * 그룹 취소는 활성(예약됨·운행중) 문서만 대상으로 한다. 그룹이 이미 전부 완료·취소된
 * 상태라면 쓰기가 0건인데, 예전에는 그때도 "0건이 취소되었습니다"를 띄우고 화면 상태를
 * 전부 cancelled로 바꿨다. 사용자는 취소됐다고 믿지만 새로고침하면 예약이 돌아오고
 * 차량은 계속 잡혀 있다 — 그 사이 아무도 그 차를 예약하지 못한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCancel } from '@/hooks/reservationCalendar/actions/cancelActions';
import type { CancelDeps } from '@/hooks/reservationCalendar/actions/types';
import type { Reservation } from '@/types/reservation';

const mockCancelReservationGroup = vi.fn();
vi.mock('@/lib/firestore', () => ({
    cancelReservation: vi.fn().mockResolvedValue({}),
    cancelReservationGroup: (...args: unknown[]) => mockCancelReservationGroup(...args),
    cancelRecurringGroup: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/hooks/useTodayDashboard', () => ({ invalidateDashboardCache: vi.fn() }));

const groupRes = (id: string, date: string, status = 'reserved') => ({
    id, date, status, groupId: 'g1', vehicleId: 'v1', startTime: '00:00', endTime: '23:59',
}) as unknown as Reservation;

function makeDeps(reservations: Reservation[]) {
    const showToast = vi.fn();
    const setReservations = vi.fn();
    const deps = {
        reservations,
        userData: { organizationId: 'org1' },
        showToast,
        confirm: vi.fn().mockResolvedValue(true),
        setReservations,
    } as unknown as CancelDeps;
    return { deps, showToast, setReservations };
}

describe('handleCancel — 다일 그룹', () => {
    beforeEach(() => vi.clearAllMocks());

    it('취소할 활성 예약이 없으면 묻지도 않고 성공한 척도 하지 않는다', async () => {
        // 그룹이 이미 전부 닫힌 상태 — "0일간 다일 예약의 일부입니다"를 띄워 확인을
        // 받아 봐야 서버에는 아무것도 쓰지 않는다.
        mockCancelReservationGroup.mockResolvedValue(0);
        const { deps, showToast, setReservations } = makeDeps([groupRes('day2', '2026-09-02', 'completed')]);

        await handleCancel('day2', deps);

        expect(deps.confirm).not.toHaveBeenCalled();
        expect(mockCancelReservationGroup).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('취소할 예약이 없습니다'), 'error');
        expect(setReservations).not.toHaveBeenCalled();
    });

    it('서버가 0건을 돌려줘도 성공한 척하지 않는다 — 화면 상태가 낡았을 때', async () => {
        // 화면에는 활성으로 보여 확인까지 갔지만, 그 사이 다른 기기에서 이미 정리된 경우다.
        mockCancelReservationGroup.mockResolvedValue(0);
        const { deps, showToast, setReservations } = makeDeps([groupRes('day1', '2026-09-01')]);

        await handleCancel('day1', deps);

        expect(mockCancelReservationGroup).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('취소할 예약이 없습니다'), 'error');
        expect(setReservations).not.toHaveBeenCalled();
    });

    it('이미 완료된 날은 취소됨으로 칠하지 않는다 — 서버가 건드리지 않은 건이다', async () => {
        // 조기 반납으로 한 그룹에 완료와 취소가 섞이는 것이 이제 흔한 모양이다.
        // 전부 취소됨으로 칠하면 이미 운행한 날이 "취소됨"으로 보였다가 새로고침에서 되돌아온다.
        mockCancelReservationGroup.mockResolvedValue(1);
        const rows = [groupRes('day1', '2026-09-01', 'completed'), groupRes('day2', '2026-09-02')];
        const { deps, setReservations } = makeDeps(rows);

        await handleCancel('day2', deps);

        const updater = setReservations.mock.calls[0][0] as (prev: Reservation[]) => Reservation[];
        expect(updater(rows).map(r => r.status)).toEqual(['completed', 'cancelled']);
    });

    it('실제로 취소된 건이 있으면 건수를 알리고 화면을 갱신한다', async () => {
        mockCancelReservationGroup.mockResolvedValue(2);
        const { deps, showToast, setReservations } = makeDeps([
            groupRes('day1', '2026-09-01'),
            groupRes('day2', '2026-09-02'),
        ]);

        await handleCancel('day1', deps);

        expect(mockCancelReservationGroup).toHaveBeenCalledWith('g1', 'org1');
        expect(showToast).toHaveBeenCalledWith('다일 예약 2건이 취소되었습니다.');
        expect(setReservations).toHaveBeenCalled();
    });
});
