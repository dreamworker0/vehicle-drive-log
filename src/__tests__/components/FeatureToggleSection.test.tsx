import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FeatureToggleSection, { type FeatureToggleValues } from '../../components/admin/settings/FeatureToggleSection';

function baseValues(overrides: Partial<FeatureToggleValues> = {}): FeatureToggleValues {
    return {
        requireReservationApproval: false,
        hipassEnabled: true,
        maintenanceEnabled: true,
        maintenanceEmployeeAccess: true,
        allowedUsersEnabled: true,
        googleCalendarEnabled: true,
        driverSelectionEnabled: true,
        coDriverEnabled: true,
        passengerEnabled: true,
        passengerAllowList: true,
        passengerAllowSearch: true,
        passengerAllowCount: true,
        driverAllowList: true,
        driverAllowSearch: true,
        ...overrides,
    };
}

function setup(overrides: Partial<FeatureToggleValues> = {}) {
    const onChange = vi.fn();
    render(<FeatureToggleSection values={baseValues(overrides)} onChange={onChange} />);
    return { onChange };
}

describe('FeatureToggleSection', () => {
    it('예약 관리자 승인 토글이 섹션 안에 표시된다', () => {
        setup();
        expect(screen.getByText('예약 관리자 승인')).toBeInTheDocument();
    });

    it('동승자 입력 방식 하위 토글은 동승자 사용 시에만 표시', () => {
        const { onChange } = setup({ passengerEnabled: false });
        expect(screen.queryByText('직원 직접 선택')).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('마지막 남은 동승자 입력 방식은 끌 수 없다(가드)', () => {
        // 목록만 켜진 상태에서 목록을 끄려 하면 onChange가 호출되지 않아야 한다
        const { onChange } = setup({ passengerAllowList: true, passengerAllowSearch: false, passengerAllowCount: false });
        const listSwitch = screen.getByRole('switch', { name: '직원 직접 선택' });
        fireEvent.click(listSwitch);
        expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ passengerAllowList: false }));
    });

    it('두 개 이상 켜진 동승자 방식은 끌 수 있다', () => {
        const { onChange } = setup({ passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true });
        fireEvent.click(screen.getByRole('switch', { name: '인원 숫자' }));
        expect(onChange).toHaveBeenCalledWith({ passengerAllowCount: false });
    });

    it('운전자 선택 방식은 운전자 지정/공동 운전자가 모두 꺼지면 숨겨진다', () => {
        setup({ driverSelectionEnabled: false, coDriverEnabled: false });
        expect(screen.queryByText('직접 선택(목록)')).not.toBeInTheDocument();
    });
});
