import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ApprovalLineSection from '../../components/admin/settings/ApprovalLineSection';
import type { SettingsForm } from '../../hooks/useSettings';

function baseForm(overrides: Partial<SettingsForm> = {}): SettingsForm {
    return {
        name: '테스트복지관',
        adminEmail: 'admin@test.com',
        address: '서울',
        phone: '010-1234-5678',
        approvalLine: [{ title: '담당' }, { title: '팀장' }],
        hideApprovalLine: false,
        requireReservationApproval: false,
        ...overrides,
    };
}

function setup(formOverrides: Partial<SettingsForm> = {}) {
    const setForm = vi.fn();
    const handleSave = vi.fn();
    render(
        <ApprovalLineSection
            form={baseForm(formOverrides)} setForm={setForm} handleSave={handleSave} saving={false}
        />,
    );
    return { setForm, handleSave };
}

describe('ApprovalLineSection', () => {
    it('결재자 목록을 입력값으로 표시', () => {
        setup();
        expect(screen.getByDisplayValue('담당')).toBeInTheDocument();
        expect(screen.getByDisplayValue('팀장')).toBeInTheDocument();
    });

    it('결재자 제목 변경 시 해당 인덱스만 갱신하여 setForm 호출', () => {
        const { setForm } = setup();
        fireEvent.change(screen.getByDisplayValue('담당'), { target: { value: '주임' } });
        expect(setForm).toHaveBeenCalledWith(
            expect.objectContaining({ approvalLine: [{ title: '주임' }, { title: '팀장' }] }),
        );
    });

    it('삭제 버튼 클릭 시 해당 결재자를 제거하여 setForm 호출', () => {
        const { setForm } = setup();
        const delButtons = screen.getAllByTitle('삭제');
        fireEvent.click(delButtons[0]);
        expect(setForm).toHaveBeenCalledWith(
            expect.objectContaining({ approvalLine: [{ title: '팀장' }] }),
        );
    });

    it('결재자 추가 버튼 클릭 시 빈 항목을 append하여 setForm 호출', () => {
        const { setForm } = setup();
        fireEvent.click(screen.getByText('+ 결재자 추가'));
        expect(setForm).toHaveBeenCalledWith(
            expect.objectContaining({ approvalLine: [{ title: '담당' }, { title: '팀장' }, { title: '' }] }),
        );
    });

    it('결재자가 5명이면 추가 버튼이 보이지 않는다', () => {
        setup({ approvalLine: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }, { title: 'e' }] });
        expect(screen.queryByText('+ 결재자 추가')).not.toBeInTheDocument();
    });

    it('hideApprovalLine=true면 추가 버튼이 숨겨진다', () => {
        setup({ hideApprovalLine: true });
        expect(screen.queryByText('+ 결재자 추가')).not.toBeInTheDocument();
    });

    it('PDF 결재란 토글 시 hideApprovalLine을 반전하여 setForm 호출', () => {
        const { setForm } = setup({ hideApprovalLine: false });
        // Toggle은 checked={!hideApprovalLine} → 현재 checked=true, 클릭 시 onChange(false) → hideApprovalLine: true
        fireEvent.click(screen.getByRole('switch'));
        expect(setForm).toHaveBeenCalledWith(
            expect.objectContaining({ hideApprovalLine: true }),
        );
    });

    it('저장 버튼 클릭 시 handleSave 호출', () => {
        const { handleSave } = setup();
        fireEvent.click(screen.getByRole('button', { name: '결재 라인 저장' }));
        expect(handleSave).toHaveBeenCalled();
    });
});
