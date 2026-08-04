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

function makeDeps(reservations: Reservation[]): EditDeps & { setForm: ReturnType<typeof vi.fn> } {
    return {
        reservations,
        members,
        setEditingReservation: vi.fn(),
        setEditingGroupId: vi.fn(),
        setEditingRecurringGroupId: vi.fn(),
        setSelectedDate: vi.fn(),
        setForm: vi.fn(),
        setShowForm: vi.fn(),
    } as unknown as EditDeps & { setForm: ReturnType<typeof vi.fn> };
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
