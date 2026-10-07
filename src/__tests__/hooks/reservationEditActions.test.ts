/**
 * handleEdit — 예약 수정 화면을 열 때의 폼 복원
 *
 * 고정하는 계약: **적어 둔 동승자가 수정 화면에서 사라지지 않는다.**
 * 단건·다일·반복 세 분기가 각각 폼을 세팅하므로, 한 분기만 빠뜨리면
 * 그 종류의 예약을 수정할 때마다 동승자가 조용히 지워진다(저장 시 빈 값이 덮어쓴다).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEdit } from '@/hooks/reservationCalendar/actions/editActions';
import type { EditDeps } from '@/hooks/reservationCalendar/actions/types';
import type { Reservation, ReservationForm } from '@/types/reservation';

const members = [
    { id: 'u1', name: '홍길동' },
    { id: 'u2', name: '김철수' },
] as unknown as EditDeps['members'];

/** 동승자: 조직원 u1 + 외부 '박영희' + 이름 없는 외부 인원 2명 */
const passengerFields = {
    passengerUids: ['u1'],
    passengerNames: ['홍길동', '박영희'],
    passengerCount: 2,
};

function makeDeps(reservations: Reservation[]): EditDeps & {
    setForm: ReturnType<typeof vi.fn>;
    setEndTimeTouched: ReturnType<typeof vi.fn>;
} {
    return {
        reservations,
        members,
        setEditingReservation: vi.fn(),
        setEditingGroupId: vi.fn(),
        setEditingRecurringGroupId: vi.fn(),
        setSelectedDate: vi.fn(),
        setForm: vi.fn(),
        setShowForm: vi.fn(),
        setEndTimeTouched: vi.fn(),
    } as unknown as EditDeps & {
        setForm: ReturnType<typeof vi.fn>;
        setEndTimeTouched: ReturnType<typeof vi.fn>;
    };
}

const formOf = (deps: { setForm: ReturnType<typeof vi.fn> }) => deps.setForm.mock.calls[0][0] as ReservationForm;

describe('handleEdit — 동승자 복원', () => {
    it('단건 예약의 동승자를 폼으로 되돌린다', () => {
        const res = {
            id: 'r1', vehicleId: 'v1', date: '2026-08-10', startTime: '10:00', endTime: '11:00',
            status: 'reserved', ...passengerFields,
        } as unknown as Reservation;
        const deps = makeDeps([res]);

        handleEdit(res, deps);

        expect(formOf(deps)).toMatchObject({
            passengerUids: ['u1'],
            passengerExternalNames: '박영희',
            passengerCount: 2,
        });
    });

    it('다일 그룹은 첫 회차의 동승자를 쓴다', () => {
        const group = [
            { id: 'r1', vehicleId: 'v1', groupId: 'grp_1', date: '2026-08-10', startTime: '09:00', endTime: '23:59', status: 'reserved', ...passengerFields },
            { id: 'r2', vehicleId: 'v1', groupId: 'grp_1', date: '2026-08-11', startTime: '00:00', endTime: '17:00', status: 'reserved' },
        ] as unknown as Reservation[];
        const deps = makeDeps(group);

        handleEdit(group[1], deps);

        expect(formOf(deps)).toMatchObject({ passengerUids: ['u1'], passengerExternalNames: '박영희', passengerCount: 2 });
    });

    it('반복 그룹도 첫 회차의 동승자를 쓴다', () => {
        const group = [
            { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved', ...passengerFields },
            { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
        ] as unknown as Reservation[];
        const deps = makeDeps(group);

        handleEdit(group[1], deps);

        expect(formOf(deps)).toMatchObject({ isRecurring: true, passengerUids: ['u1'], passengerExternalNames: '박영희' });
    });

    it('동승자가 없던 예약은 빈 값으로 연다', () => {
        const res = {
            id: 'r1', vehicleId: 'v1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved',
        } as unknown as Reservation;
        const deps = makeDeps([res]);

        handleEdit(res, deps);

        expect(formOf(deps)).toMatchObject({ passengerUids: [], passengerExternalNames: '', passengerCount: 0 });
    });
});

/**
 * 저장된 종료시간은 **사람이 정한 값**이다. 수정 진입이 잠가 두지 않으면, 목적지가 이미 채워져
 * 있으므로 경로 조회가 돌고 1.2초 뒤 결과가 그 값을 갈아치운다 — 사용자는 목적지만 고치러
 * 들어왔는데 시간이 바뀐 채 저장된다(2026-09-16 신고 2건). 잠금 자체의 효과는
 * useRouteInfo.test.ts가 다루고, 여기서는 **세 갈래 모두 잠그는지**를 고정한다.
 */
describe('handleEdit — 종료시간 잠금', () => {
    it('단건 수정은 종료시간을 잠근다', () => {
        const res = {
            id: 'r1', vehicleId: 'v1', date: '2026-08-10', startTime: '10:00', endTime: '18:00', status: 'reserved',
        } as unknown as Reservation;
        const deps = makeDeps([res]);

        handleEdit(res, deps);

        expect(deps.setEndTimeTouched).toHaveBeenCalledWith(true);
        expect(formOf(deps)).toMatchObject({ endTime: '18:00' });
    });

    it('다일 그룹 수정도 잠근다 — 마지막 날 종료시간이 첫날 기준으로 뭉개지던 자리', () => {
        const group = [
            { id: 'r1', vehicleId: 'v1', groupId: 'grp_1', date: '2026-08-10', startTime: '09:00', endTime: '23:59', status: 'reserved' },
            { id: 'r2', vehicleId: 'v1', groupId: 'grp_1', date: '2026-08-12', startTime: '00:00', endTime: '18:00', status: 'reserved' },
        ] as unknown as Reservation[];
        const deps = makeDeps(group);

        handleEdit(group[0], deps);

        expect(deps.setEndTimeTouched).toHaveBeenCalledWith(true);
        // 마지막 날의 종료시간이 그대로 들어와야 한다(첫날 기준 계산값으로 바뀌면 예약이 줄어든다)
        expect(formOf(deps)).toMatchObject({ endTime: '18:00', endDate: '2026-08-12' });
    });

    it('반복 그룹 수정도 잠근다', () => {
        const group = [
            { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '18:00', status: 'reserved' },
            { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-17', startTime: '10:00', endTime: '18:00', status: 'reserved' },
        ] as unknown as Reservation[];
        const deps = makeDeps(group);

        handleEdit(group[0], deps);

        expect(deps.setEndTimeTouched).toHaveBeenCalledWith(true);
        expect(formOf(deps)).toMatchObject({ endTime: '18:00', isRecurring: true });
    });
});
