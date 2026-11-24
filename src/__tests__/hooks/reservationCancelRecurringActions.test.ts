/**
 * handleCancel — 반복 예약·단건 예약 취소 (다일 그룹은 reservationCancelActions.test.ts)
 *
 * 고정하는 계약:
 *  - 반복 예약은 "전체 취소 / 이 날짜만"을 묻고, 다이얼로그를 닫으면 아무것도 하지 않는다
 *  - 전체 취소는 **기관 ID와 함께** 서버에 보내고, 서버가 0건이면 성공한 척하지 않는다
 *  - 화면 갱신은 활성 예약만 취소됨으로 칠한다(완료된 날은 그대로)
 *  - 실패는 서버 메시지를 그대로 보여 주고 화면을 바꾸지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CancelDeps } from '@/hooks/reservationCalendar/actions/types';
import type { Reservation } from '@/types/reservation';

const mockCancelReservation = vi.fn();
const mockCancelRecurringGroup = vi.fn();
vi.mock('@/lib/firestore', () => ({
    cancelReservation: (...a: unknown[]) => mockCancelReservation(...a),
    cancelReservationGroup: vi.fn(),
    cancelRecurringGroup: (...a: unknown[]) => mockCancelRecurringGroup(...a),
}));
const mockInvalidate = vi.fn();
vi.mock('@/hooks/useTodayDashboard', () => ({ invalidateDashboardCache: () => mockInvalidate() }));

import { handleCancel } from '@/hooks/reservationCalendar/actions/cancelActions';

const rec = (id: string, date: string, status = 'reserved', extra: Record<string, unknown> = {}) => ({
    id, date, status, recurringGroupId: 'rg1', vehicleId: 'v1', startTime: '09:00', endTime: '10:00', ...extra,
}) as unknown as Reservation;
const single = (id: string) => ({
    id, date: '2026-11-25', status: 'reserved', vehicleId: 'v1', startTime: '09:00', endTime: '10:00',
}) as unknown as Reservation;

function makeDeps(reservations: Reservation[], confirmResult: boolean | string | null = true, orgId: string | null = 'org1') {
    const showToast = vi.fn();
    const setReservations = vi.fn();
    const confirm = vi.fn().mockResolvedValue(confirmResult);
    const deps = {
        reservations,
        userData: orgId === null ? null : { organizationId: orgId },
        showToast, confirm, setReservations,
    } as unknown as CancelDeps;
    /** setReservations에 넘긴 갱신 함수를 현재 목록에 적용한 결과 */
    const applied = () => {
        const updater = setReservations.mock.calls[0][0] as (prev: Reservation[]) => Reservation[];
        return updater(reservations);
    };
    return { deps, showToast, setReservations, confirm, applied };
}

describe('handleCancel — 반복 예약', () => {
    const group = [
        rec('r1', '2026-11-03', 'completed'),
        rec('r2', '2026-11-10', 'cancelled'),
        rec('r3', '2026-11-17'),
        rec('r4', '2026-11-24'),
        single('other'),
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        mockCancelReservation.mockResolvedValue({});
        mockCancelRecurringGroup.mockResolvedValue(2);
    });

    it('남은 활성 회차 수를 보여 주며 전체/이 날짜만을 묻는다', async () => {
        const { deps, confirm } = makeDeps(group, null);

        await handleCancel('r3', deps);

        const opts = confirm.mock.calls[0][0];
        expect(opts.title).toBe('반복 예약 취소');
        expect(opts.message).toContain('반복 예약 그룹(2건)');
        expect(opts.confirmText).toBe('전체 취소');
        expect(opts.cancelText).toBe('이 날짜만');
    });

    it.each([null, undefined])('다이얼로그를 닫으면(%s) 아무것도 취소하지 않는다', async (closed) => {
        const { deps, setReservations, showToast, confirm } = makeDeps(group);
        // makeDeps의 기본값(true)이 undefined를 덮지 않도록 확인 결과를 직접 지정한다
        confirm.mockResolvedValue(closed);

        await handleCancel('r3', deps);

        expect(mockCancelRecurringGroup).not.toHaveBeenCalled();
        expect(mockCancelReservation).not.toHaveBeenCalled();
        expect(setReservations).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('전체 취소는 기관 ID와 함께 보내고, 활성 회차만 취소됨으로 칠한다', async () => {
        const { deps, showToast, applied } = makeDeps(group, true);

        await handleCancel('r3', deps);

        expect(mockCancelRecurringGroup).toHaveBeenCalledWith('rg1', 'org1');
        expect(showToast).toHaveBeenCalledWith('반복 예약 2건이 취소되었습니다.');
        expect(applied().map(r => [r.id, r.status])).toEqual([
            ['r1', 'completed'], // 이미 운행한 날은 그대로
            ['r2', 'cancelled'],
            ['r3', 'cancelled'],
            ['r4', 'cancelled'],
            ['other', 'reserved'], // 다른 그룹·단건은 건드리지 않는다
        ]);
        expect(mockInvalidate).toHaveBeenCalled();
    });

    it('기관 정보가 없으면 빈 기관 ID로 보낸다 (서버가 거부한다)', async () => {
        const { deps } = makeDeps(group, true, null);

        await handleCancel('r3', deps);

        expect(mockCancelRecurringGroup).toHaveBeenCalledWith('rg1', '');
    });

    it('서버가 0건을 돌려주면 성공한 척하지 않고 화면도 바꾸지 않는다', async () => {
        mockCancelRecurringGroup.mockResolvedValue(0);
        const { deps, showToast, setReservations } = makeDeps(group, true);

        await handleCancel('r3', deps);

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('취소할 예약이 없습니다'), 'error');
        expect(setReservations).not.toHaveBeenCalled();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('"이 날짜만"은 그 회차만 취소하고 목록에 취소됨으로 남긴다', async () => {
        const { deps, showToast, applied } = makeDeps(group, false);

        await handleCancel('r4', deps);

        expect(mockCancelReservation).toHaveBeenCalledWith('r4');
        expect(mockCancelRecurringGroup).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('해당 날짜의 예약이 취소되었습니다.');
        const after = applied();
        expect(after.find(r => r.id === 'r4')!.status).toBe('cancelled');
        expect(after.find(r => r.id === 'r3')!.status).toBe('reserved');
        expect(after).toHaveLength(group.length);
        expect(mockInvalidate).toHaveBeenCalled();
    });

    it('실패하면 서버 메시지를 보여 주고 화면을 바꾸지 않는다', async () => {
        mockCancelRecurringGroup.mockRejectedValue(new Error('이미 시작된 예약은 취소할 수 없습니다.'));
        const { deps, showToast, setReservations } = makeDeps(group, true);

        await handleCancel('r3', deps);

        expect(showToast).toHaveBeenCalledWith('이미 시작된 예약은 취소할 수 없습니다.', 'error');
        expect(setReservations).not.toHaveBeenCalled();
    });

    it('Error가 아닌 실패는 기본 문구로 보여 준다', async () => {
        mockCancelReservation.mockRejectedValue('boom');
        const { deps, showToast } = makeDeps(group, false);

        await handleCancel('r3', deps);

        expect(showToast).toHaveBeenCalledWith('취소에 실패했습니다.', 'error');
    });

    // 2026-11-24 수정: 다일 그룹과 같은 동작으로 맞췄다 — 예전에는 "반복 예약 그룹(0건)" 확인창을 띄웠다.
    it('반복 그룹의 활성 회차가 0건이면 확인창 없이 안내하고 서버에 아무것도 보내지 않는다', async () => {
        const done = [rec('d1', '2026-11-20', 'completed'), rec('d2', '2026-11-21', 'cancelled')];
        const { deps, showToast, confirm, setReservations } = makeDeps(done);

        await handleCancel('d1', deps);

        expect(confirm).not.toHaveBeenCalled();
        expect(mockCancelRecurringGroup).not.toHaveBeenCalled();
        expect(mockCancelReservation).not.toHaveBeenCalled();
        expect(setReservations).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('취소할 예약이 없습니다. 이미 완료되었거나 취소된 예약입니다.', 'error');
    });
});

describe('handleCancel — 단건 예약', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCancelReservation.mockResolvedValue({});
    });

    it('확인 후 취소하고 목록에서 뺀다', async () => {
        const list = [single('s1'), single('s2')];
        const { deps, confirm, showToast, applied } = makeDeps(list, true);

        await handleCancel('s1', deps);

        expect(confirm).toHaveBeenCalledWith({ message: '예약을 취소하시겠습니까?', confirmColor: 'danger' });
        expect(mockCancelReservation).toHaveBeenCalledWith('s1');
        expect(showToast).toHaveBeenCalledWith('예약이 취소되었습니다.');
        expect(applied().map(r => r.id)).toEqual(['s2']);
        expect(mockInvalidate).toHaveBeenCalled();
    });

    it('확인창에서 거절하면 취소하지 않는다', async () => {
        const { deps, setReservations } = makeDeps([single('s1')], false);

        await handleCancel('s1', deps);

        expect(mockCancelReservation).not.toHaveBeenCalled();
        expect(setReservations).not.toHaveBeenCalled();
    });

    it('목록에 없는 ID도 단건 취소로 처리한다', async () => {
        const { deps } = makeDeps([], true);

        await handleCancel('ghost', deps);

        expect(mockCancelReservation).toHaveBeenCalledWith('ghost');
    });

    it('실패하면 서버 메시지를 보여 주고 목록을 그대로 둔다', async () => {
        mockCancelReservation.mockRejectedValue(new Error('권한이 없습니다.'));
        const { deps, showToast, setReservations } = makeDeps([single('s1')], true);

        await handleCancel('s1', deps);

        expect(showToast).toHaveBeenCalledWith('권한이 없습니다.', 'error');
        expect(setReservations).not.toHaveBeenCalled();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('Error가 아닌 실패는 기본 문구로 보여 준다', async () => {
        mockCancelReservation.mockRejectedValue({ code: 'unknown' });
        const { deps, showToast } = makeDeps([single('s1')], true);

        await handleCancel('s1', deps);

        expect(showToast).toHaveBeenCalledWith('취소에 실패했습니다.', 'error');
    });
});

describe('handleCancel — 다일 그룹 실패 경로', () => {
    it('그룹 취소가 실패하면 서버 메시지를 보여 준다', async () => {
        const { cancelReservationGroup } = await import('@/lib/firestore');
        vi.mocked(cancelReservationGroup).mockRejectedValueOnce(new Error('네트워크 오류'));
        const groupRes = { id: 'g-a', date: '2026-11-25', status: 'reserved', groupId: 'g1' } as unknown as Reservation;
        const { deps, showToast, setReservations } = makeDeps([groupRes], true);

        await handleCancel('g-a', deps);

        expect(cancelReservationGroup).toHaveBeenCalledWith('g1', 'org1');
        expect(showToast).toHaveBeenCalledWith('네트워크 오류', 'error');
        expect(setReservations).not.toHaveBeenCalled();
    });

    it('그룹 취소 확인창에서 돌아가기를 누르면 보내지 않는다', async () => {
        const { cancelReservationGroup } = await import('@/lib/firestore');
        vi.mocked(cancelReservationGroup).mockClear();
        const groupRes = { id: 'g-a', date: '2026-11-25', status: 'reserved', groupId: 'g1' } as unknown as Reservation;
        const { deps } = makeDeps([groupRes], false);

        await handleCancel('g-a', deps);

        expect(cancelReservationGroup).not.toHaveBeenCalled();
    });
});
