/**
 * actions/editActions.ts
 * 예약 수정 준비 (handleEdit) — 폼 상태를 수정 모드로 세팅
 */
import { resolveReservationPassengers } from '../../utils/reservationPassengers';
import type { Reservation } from '../../../types/reservation';
import type { EditDeps } from './types';

/**
 * 저장된 동승자(예정)를 폼 입력 형태로 되돌린다.
 * 세 분기(반복·다일·단건)가 모두 같은 복원을 써야 "수정을 열었더니 적어 둔 동승자가
 * 사라진" 상태가 생기지 않는다.
 */
function passengerFormFields(res: Reservation, members: EditDeps['members']) {
    const { selected, externalNames, count } = resolveReservationPassengers(res, members || []);
    return {
        passengerUids: selected.map(m => m.id),
        passengerExternalNames: externalNames.join(', '),
        passengerCount: count,
    };
}

export function handleEdit(res: Reservation, deps: EditDeps) {
    const {
        reservations, members,
        setEditingReservation, setEditingGroupId, setEditingRecurringGroupId,
        setSelectedDate, setForm, setShowForm,
    } = deps;

    if (res.recurringGroupId) {
        // 반복 예약 그룹 수정 — 그룹의 모든 활성 예약 조회
        const groupReservations = reservations
            .filter(r => r.recurringGroupId === res.recurringGroupId && r.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date));

        if (groupReservations.length > 0) {
            const first = groupReservations[0];
            const last = groupReservations[groupReservations.length - 1];

            // 요일 패턴 추출 (그룹 내 고유 요일)
            const daySet = new Set(groupReservations.map(r => new Date(r.date + 'T00:00').getDay()));

            setEditingReservation(res);
            setEditingRecurringGroupId(res.recurringGroupId!);
            setEditingGroupId(null);
            setSelectedDate(first.date);
            setForm({
                vehicleId: first.vehicleId,
                destination: first.destination || '',
                purpose: first.purpose || '',
                startTime: first.startTime,
                endTime: first.endTime,
                reservedByUid: first.reservedByUid,
                reservedByName: first.reservedByName,
                isRecurring: true,
                recurringDays: [...daySet].sort(),
                recurringEndDate: last.date,
                excludeHolidays: true,
                excludedDates: [],
                ...passengerFormFields(first, members),
            });
            setShowForm(true);
            return;
        }
    }

    if (res.groupId) {
        // 그룹의 전체 예약 찾기
        const groupReservations = reservations
            .filter(r => r.groupId === res.groupId && r.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date));

        if (groupReservations.length > 0) {
            const first = groupReservations[0];
            const last = groupReservations[groupReservations.length - 1];
            setEditingReservation(res);
            setEditingGroupId(res.groupId);
            setSelectedDate(first.date);
            setForm({
                vehicleId: first.vehicleId,
                destination: first.destination || '',
                purpose: first.purpose || '',
                startTime: first.startTime,
                endTime: last.endTime,
                endDate: last.date !== first.date ? last.date : '',
                reservedByUid: first.reservedByUid,
                reservedByName: first.reservedByName,
                ...passengerFormFields(first, members),
            });
            setShowForm(true);
            return;
        }
    }

    // 단건 수정
    setEditingReservation(res);
    setEditingGroupId(null);
    setForm({
        vehicleId: res.vehicleId,
        destination: res.destination || '',
        purpose: res.purpose || '',
        startTime: res.startTime,
        endTime: res.endTime,
        reservedByUid: res.reservedByUid,
        reservedByName: res.reservedByName,
        ...passengerFormFields(res, members),
    });
    setShowForm(true);
}
