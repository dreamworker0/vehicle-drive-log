import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Toggle from '../../components/common/Toggle';

describe('Toggle (공용 토글 스위치)', () => {
    it('role="switch"와 aria-checked로 상태를 노출한다', () => {
        const { rerender } = render(<Toggle checked={false} onChange={() => {}} label="다크 모드" />);
        const toggle = screen.getByRole('switch', { name: '다크 모드' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        rerender(<Toggle checked={true} onChange={() => {}} label="다크 모드" />);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('클릭 시 onChange에 다음 값(!checked)을 전달한다', () => {
        const onChange = vi.fn();
        render(<Toggle checked={false} onChange={onChange} label="알림" />);

        fireEvent.click(screen.getByRole('switch'));
        expect(onChange).toHaveBeenCalledWith(true);

        onChange.mockClear();
        render(<Toggle checked={true} onChange={onChange} label="알림 켜짐" />);
        fireEvent.click(screen.getByRole('switch', { name: '알림 켜짐' }));
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('disabled면 클릭해도 onChange가 호출되지 않는다', () => {
        const onChange = vi.fn();
        render(<Toggle checked={false} onChange={onChange} label="비활성" disabled />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toBeDisabled();
        fireEvent.click(toggle);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('form 안에서도 submit을 일으키지 않는다 (type="button")', () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <Toggle checked={false} onChange={() => {}} label="폼 내부" />
            </form>,
        );

        fireEvent.click(screen.getByRole('switch'));
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
