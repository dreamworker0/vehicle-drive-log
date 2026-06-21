import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReservationApprovalSection from '../../components/admin/settings/ReservationApprovalSection';

describe('ReservationApprovalSection', () => {
    it('checked=true면 "사용" 라벨을 표시', () => {
        render(<ReservationApprovalSection checked onChange={vi.fn()} />);
        expect(screen.getByText('사용')).toBeInTheDocument();
    });

    it('checked=false면 "사용 안함" 라벨을 표시', () => {
        render(<ReservationApprovalSection checked={false} onChange={vi.fn()} />);
        expect(screen.getByText('사용 안함')).toBeInTheDocument();
    });

    it('토글 클릭 시 반전된 값으로 onChange 호출', () => {
        const onChange = vi.fn();
        render(<ReservationApprovalSection checked={false} onChange={onChange} />);
        fireEvent.click(screen.getByRole('switch'));
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
