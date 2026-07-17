import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OrgInfoSection from '../../components/admin/settings/OrgInfoSection';
import type { SettingsForm } from '../../hooks/useSettings';

function baseForm(overrides: Partial<SettingsForm> = {}): SettingsForm {
    return {
        name: '테스트복지관',
        adminEmail: 'admin@test.com',
        address: '',
        phone: '010-1234-5678',
        approvalLine: [{ title: '담당' }],
        hideApprovalLine: false,
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

function baseProps() {
    return {
        form: baseForm(),
        setForm: vi.fn(),
        handlePhoneChange: vi.fn(),
        handleSave: vi.fn(),
        saving: false,
        onRequestFeedback: vi.fn(),
    };
}

describe('OrgInfoSection', () => {
    it('기관명/이메일을 표시한다', () => {
        render(<OrgInfoSection {...baseProps()} />);
        expect(screen.getByDisplayValue('테스트복지관')).toBeInTheDocument();
        expect(screen.getByDisplayValue('admin@test.com')).toBeInTheDocument();
    });

    it('주소가 비어 있으면 입력 가능하고 변경 시 setForm 호출', () => {
        const props = baseProps();
        render(<OrgInfoSection {...props} />);
        const addrInput = screen.getByPlaceholderText(/AI가 주소를 읽지 못한/);
        fireEvent.change(addrInput, { target: { value: '서울시 중구' } });
        expect(props.setForm).toHaveBeenCalled();
    });

    it('전화번호 변경 시 handlePhoneChange 호출', () => {
        const props = baseProps();
        render(<OrgInfoSection {...props} />);
        fireEvent.change(screen.getByPlaceholderText('010-0000-0000'), { target: { value: '01099998888' } });
        expect(props.handlePhoneChange).toHaveBeenCalled();
    });

    it('저장 버튼 클릭(submit) 시 handleSave 호출', () => {
        const props = baseProps();
        render(<OrgInfoSection {...props} />);
        fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }));
        expect(props.handleSave).toHaveBeenCalled();
    });

    it('saving=true면 저장 버튼이 비활성', () => {
        render(<OrgInfoSection {...baseProps()} saving />);
        expect(screen.getByRole('button', { name: /저장 중/ })).toBeDisabled();
    });

    it('피드백 버튼 클릭 시 onRequestFeedback 호출', () => {
        const props = baseProps();
        render(<OrgInfoSection {...props} />);
        fireEvent.click(screen.getByText(/슈퍼관리자에게 요청하세요/));
        expect(props.onRequestFeedback).toHaveBeenCalled();
    });
});
