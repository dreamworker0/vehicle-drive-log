/**
 * RecurringReservationPanel — 반복 예약 미리보기의 충돌 표시
 *
 * 고정하는 계약: **수정 중인 반복 그룹 자신은 충돌이 아니다.**
 * 그룹 수정은 기존 예약을 지우고 다시 만드는 방식이라 자기 예약과의 겹침은 정상이다.
 * 이 구분이 무너지면 반복 그룹을 열자마자 모든 날짜에 ⚠️가 붙어(20일이면 "충돌 20건")
 * 실제로 비어 있는 시간인지 아닌지를 화면에서 판단할 수 없게 된다.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecurringReservationPanel from '../../components/common/reservation/RecurringReservationPanel';
import type { Reservation, ReservationForm } from '../../types/reservation';

const form = {
    vehicleId: 'v1',
    destination: '복지관',
    purpose: '식사납품',
    startTime: '10:00',
    endTime: '11:00',
    isRecurring: true,
    recurringDays: [1], // 월요일
    recurringStartDate: '2026-08-03', // 월
    recurringEndDate: '2026-08-10',   // 그다음 월
    excludeHolidays: false,
    excludedDates: [],
} as unknown as ReservationForm;

/** 위 폼이 만드는 두 날짜(8/3·8/10)를 차지하고 있는 같은 차량의 예약 */
const groupReservations = [
    { id: 'a1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved' },
    { id: 'a2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
] as unknown as Reservation[];

function renderPanel(props: Partial<React.ComponentProps<typeof RecurringReservationPanel>> = {}) {
    return render(
        <RecurringReservationPanel
            form={form}
            setForm={vi.fn()}
            selectedDate="2026-08-03"
            holidays={[]}
            allReservations={groupReservations}
            {...props}
        />,
    );
}

describe('RecurringReservationPanel — 충돌 표시', () => {
    it('수정 중인 그룹의 예약은 충돌로 세지 않는다', () => {
        renderPanel({ editingRecurringGroupId: 'rcr_1' });

        expect(screen.getByText(/예약될 날짜/)).toBeInTheDocument();
        expect(screen.queryByText(/충돌/)).not.toBeInTheDocument();
    });

    it('다른 예약과 겹치면 그 건수를 표시한다 (제외의 대조군)', () => {
        // 그룹 ID가 다르면 남의 예약이므로 충돌이 맞다
        renderPanel({ editingRecurringGroupId: 'rcr_다른그룹' });

        expect(screen.getByText(/충돌 2건/)).toBeInTheDocument();
    });

    it('신규 생성(수정 중인 그룹 없음)에서도 겹치는 예약은 충돌로 잡는다', () => {
        renderPanel();

        expect(screen.getByText(/충돌 2건/)).toBeInTheDocument();
    });
});
