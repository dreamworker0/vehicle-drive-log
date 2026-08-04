/**
 * ReservationTypeSelector — 반복 그룹 수정 중의 유형 전환
 *
 * 고정하는 계약: **반복 그룹을 수정하는 중에도 다일 예약으로 바꿀 수 있다.**
 * 체크박스를 잠가 두면 한 달치 반복을 며칠짜리 연속 운행으로 바꿀 방법이
 * "전부 취소하고 처음부터 다시" 밖에 없어진다.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReservationTypeSelector from '../../components/common/reservation/ReservationTypeSelector';
import type { ReservationForm } from '../../types/reservation';

const recurringForm = {
    vehicleId: 'v1',
    destination: '복지관',
    purpose: '식사배달',
    startTime: '10:00',
    endTime: '11:00',
    isRecurring: true,
    recurringDays: [1, 2, 3, 4, 5],
    recurringEndDate: '2026-08-31',
} as unknown as ReservationForm;

/** 체크박스는 라벨 텍스트로 찾는다 (label > input 구조) */
const multiDayCheckbox = () => screen.getByText(/다일 예약/).closest('label')!.querySelector('input')!;

function renderSelector(props: Partial<React.ComponentProps<typeof ReservationTypeSelector>> = {}) {
    const setForm = vi.fn();
    render(
        <ReservationTypeSelector
            form={recurringForm}
            setForm={setForm}
            selectedDate="2026-08-03"
            {...props}
        />,
    );
    return { setForm };
}

describe('ReservationTypeSelector — 반복 그룹 수정 중 유형 전환', () => {
    it('반복 그룹 수정 중에도 다일 예약 체크박스가 잠기지 않는다', () => {
        renderSelector({ editingRecurringGroupId: 'rcr_1' });

        expect(multiDayCheckbox()).not.toBeDisabled();
    });

    it('다일을 체크하면 반복이 꺼지고 종료일이 다음 날로 잡힌다 (전환 대상 구간)', () => {
        const { setForm } = renderSelector({ editingRecurringGroupId: 'rcr_1' });

        fireEvent.click(multiDayCheckbox());

        expect(setForm).toHaveBeenCalledTimes(1);
        const updater = setForm.mock.calls[0][0] as (prev: ReservationForm) => ReservationForm;
        expect(updater(recurringForm)).toMatchObject({
            isRecurring: false,
            endDate: '2026-08-04',
        });
    });
});
