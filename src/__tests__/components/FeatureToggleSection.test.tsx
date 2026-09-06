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
    reservationPassengerEnabled: false,
    refuelFlagEnabled: false,
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

describe('하위 설정이 붙는 자리', () => {
    it('[접근 범위]는 바로 위가 수리·정비여야 한다 — 다른 기능의 하위 설정처럼 보이면 안 된다', () => {
        // 이 그룹은 수리·정비에만 걸리는데, 목록 **뒤에** 붙는 구조라 끝에 다른 기능이
        // 오면 그 기능의 하위 설정으로 읽힌다. 실제로 주유·충전 필요 표시를 뒤에 추가한
        // 뒤 그렇게 보였다(사용자 신고, 2026-09-06). 순서만이 이것을 지킨다.
        setup({ maintenanceEnabled: true });

        const caption = screen.getByText(/접근 범위/);
        const labels = Array.from(document.querySelectorAll('label, p, span, h3'))
            .filter(el => el.textContent && ['하이패스', '수리·정비', '주유·충전 필요 표시'].includes(el.textContent.trim()));

        const last = labels[labels.length - 1];
        expect(last?.textContent?.trim()).toBe('수리·정비');
        // 캡션이 대상을 밝히는지도 함께 고정한다 — 순서가 또 바뀌어도 글로는 남는다
        expect(caption.textContent).toContain('수리·정비');
    });

    it('수리·정비를 끄면 접근 범위도 사라진다', () => {
        setup({ maintenanceEnabled: false });
        expect(screen.queryByText(/접근 범위/)).toBeNull();
    });
});
