import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useConfirmStore } from '../../store/useConfirmStore';

const TestConfirmModal = () => {
    const { open, options, handleConfirm, handleCancel } = useConfirmStore();
    return (
        <ConfirmModal
            open={open}
            title={options.title}
            message={options.message}
            type={options.type}
            inputPlaceholder={options.inputPlaceholder}
            confirmText={options.confirmText || '확인'}
            cancelText={options.cancelText || '취소'}
            confirmColor={options.confirmColor || 'primary'}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    );
};

describe('ConfirmModal Component', () => {
    beforeEach(() => {
        // Zustand 스토어 초기화
        useConfirmStore.setState({
            open: true,
            options: {
                type: 'confirm',
                title: '확인 모달',
                message: '진행하시겠습니까?',
                confirmColor: 'primary',
                inputPlaceholder: '',
                confirmText: '확인',
                cancelText: '취소',
            },
            resolveCallback: vi.fn(),
        });
    });

    it('store 상태에 따라 모달 제목과 내용이 올바르게 렌더링된다', () => {
        render(<TestConfirmModal />);
        expect(screen.getByText('확인 모달')).toBeInTheDocument();
        expect(screen.getByText('진행하시겠습니까?')).toBeInTheDocument();
    });

    it('다크 모드에서도 사용하기 적합한 dialog 역할을 가진다', () => {
        render(<TestConfirmModal />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // 테마를 전환하는 클래스들이 제대로 포함되어있는지 확인
        // 모달창 래퍼 자체가 .glass-card를 가진 요소이다.
        expect(dialog.classList.contains('glass-card')).toBe(true);
    });

    it('확인 버튼 클릭 시 resolve에 true를 전달하고 닫힌다', async () => {
        render(<TestConfirmModal />);
        const resolveFn = useConfirmStore.getState().resolveCallback;
        
        fireEvent.click(screen.getByText('확인'));
        expect(resolveFn).toHaveBeenCalledWith(true);
        expect(useConfirmStore.getState().open).toBe(false);
    });

    it('취소 버튼 클릭 시 resolve에 false를 전달하고 닫힌다', () => {
        render(<TestConfirmModal />);
        const resolveFn = useConfirmStore.getState().resolveCallback;
        
        fireEvent.click(screen.getByText('취소'));
        expect(resolveFn).toHaveBeenCalledWith(false);
        expect(useConfirmStore.getState().open).toBe(false);
    });

    it('마지막 버튼에서 Tab을 누르면 첫 버튼으로 순환한다 (포커스 트랩)', () => {
        render(<TestConfirmModal />);
        const cancel = screen.getByRole('button', { name: '취소' });
        const confirm = screen.getByRole('button', { name: '확인' });
        confirm.focus();
        expect(confirm).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(cancel).toHaveFocus();
    });

    it('첫 버튼에서 Shift+Tab을 누르면 마지막 버튼으로 순환한다 (포커스 트랩)', () => {
        render(<TestConfirmModal />);
        const cancel = screen.getByRole('button', { name: '취소' });
        const confirm = screen.getByRole('button', { name: '확인' });
        cancel.focus();
        expect(cancel).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(confirm).toHaveFocus();
    });

    it('타입이 input일 때 입력박스가 렌더링되고 입력값을 resolve로 전달한다', () => {
        useConfirmStore.setState({
            ...useConfirmStore.getState(),
            options: {
                ...useConfirmStore.getState().options,
                type: 'input',
                inputPlaceholder: '반려 사유 입력'
            },
            resolveCallback: useConfirmStore.getState().resolveCallback || vi.fn()
        });
        render(<TestConfirmModal />);
        
        const input = screen.getByPlaceholderText('반려 사유 입력');
        expect(input).toBeInTheDocument();

        fireEvent.change(input, { target: { value: '일정 중복' } });
        const resolveFn = useConfirmStore.getState().resolveCallback;
        fireEvent.click(screen.getByText('확인'));

        expect(resolveFn).toHaveBeenCalledWith('일정 중복');
    });
});
