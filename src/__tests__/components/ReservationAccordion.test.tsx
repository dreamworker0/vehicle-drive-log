import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReservationAccordion from '../../components/common/ReservationAccordion';
import type { Reservation } from '../../types/reservation';

const futureRes = {
    id: 'r1',
    vehicleId: 'v1',
    reservedByName: '홍길동',
    reservedByUid: 'u1',
    date: '2999-12-31',
    startTime: '09:00',
    endTime: '10:00',
    destination: '시청',
    purpose: '출장',
    status: 'approved',
} as unknown as Reservation;

const adminUser = { uid: 'admin', id: 'admin' };

describe('ReservationAccordion', () => {
    it('isExpanded=false면 아무것도 렌더하지 않는다', () => {
        const { container } = render(
            <ReservationAccordion reservations={[futureRes]} isExpanded={false} user={adminUser} isAdmin />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('예약이 없으면 렌더하지 않는다', () => {
        const { container } = render(
            <ReservationAccordion reservations={[]} isExpanded user={adminUser} isAdmin />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('펼쳐지면 예약자/시간/목적지를 표시한다', () => {
        render(<ReservationAccordion reservations={[futureRes]} isExpanded user={adminUser} isAdmin />);
        expect(screen.getByText('홍길동')).toBeInTheDocument();
        expect(screen.getByText(/09:00 ~ 10:00/)).toBeInTheDocument();
        expect(screen.getByText('시청')).toBeInTheDocument();
    });

    it('관리자면 수정/취소 버튼이 보이고 콜백이 호출된다', () => {
        const onEdit = vi.fn();
        const onCancel = vi.fn();
        render(
            <ReservationAccordion
                reservations={[futureRes]} isExpanded user={adminUser} isAdmin
                onEdit={onEdit} onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByText('수정'));
        fireEvent.click(screen.getByText('취소'));
        expect(onEdit).toHaveBeenCalledWith(futureRes);
        expect(onCancel).toHaveBeenCalledWith('r1');
    });

    it('시간이 지난 예약도 소유자면 수정/취소할 수 있다', () => {
        // 타지 않은 지난 예약을 지울 방법이 없으면 기록에 그대로 남는다
        const pastRes = { ...futureRes, id: 'r-past', date: '2020-01-01' } as Reservation;
        const onCancel = vi.fn();
        render(
            <ReservationAccordion
                reservations={[pastRes]} isExpanded
                user={{ uid: 'u1', id: 'u1' }} isAdmin={false}
                onCancel={onCancel}
            />,
        );
        expect(screen.getByText('수정')).toBeInTheDocument();
        fireEvent.click(screen.getByText('취소'));
        expect(onCancel).toHaveBeenCalledWith('r-past');
    });

    it('권한 없는 사용자(비관리자·비소유자)에겐 수정/취소 버튼이 없다', () => {
        render(
            <ReservationAccordion
                reservations={[futureRes]} isExpanded
                user={{ uid: 'other', id: 'other' }} isAdmin={false}
            />,
        );
        expect(screen.queryByText('수정')).not.toBeInTheDocument();
        expect(screen.queryByText('취소')).not.toBeInTheDocument();
    });
});

// 외부 대여 — 관리자에게, 대여가 시작된 뒤에만 [반납 처리]가 보인다
describe('ReservationAccordion — 외부 대여', () => {
    const loanRes = {
        id: 'L1', vehicleId: 'v1', reservedByUid: '', reservedByName: '(외부) 동산 사회복지관 홍길동',
        date: '2026-10-20', startTime: '14:00', endTime: '23:59', status: 'reserved',
        externalLoan: { borrowerOrg: '동산 사회복지관', driverName: '홍길동' },
    } as unknown as Reservation;
    const afterStart = new Date(2026, 9, 20, 15, 0);
    const beforeStart = new Date(2026, 9, 20, 13, 0);

    it('대여 배지를 단다', () => {
        render(<ReservationAccordion reservations={[loanRes]} isExpanded user={adminUser} isAdmin now={afterStart} />);
        expect(screen.getByText('외부 대여')).toBeInTheDocument();
    });

    it('시작 뒤 관리자에게 [반납 처리]를 보이고, 누르면 그 예약으로 연다', () => {
        const onReturnLoan = vi.fn();
        render(<ReservationAccordion reservations={[loanRes]} isExpanded user={adminUser} isAdmin onReturnLoan={onReturnLoan} now={afterStart} />);
        fireEvent.click(screen.getByText('반납 처리'));
        expect(onReturnLoan).toHaveBeenCalledWith(loanRes);
    });

    it('시작 전·직원·이미 반납한 대여에는 보이지 않는다', () => {
        const onReturnLoan = vi.fn();
        const { rerender } = render(<ReservationAccordion reservations={[loanRes]} isExpanded user={adminUser} isAdmin onReturnLoan={onReturnLoan} now={beforeStart} />);
        expect(screen.queryByText('반납 처리')).toBeNull();
        rerender(<ReservationAccordion reservations={[loanRes]} isExpanded user={{ uid: 'emp' }} isAdmin={false} onReturnLoan={onReturnLoan} now={afterStart} />);
        expect(screen.queryByText('반납 처리')).toBeNull();
        rerender(<ReservationAccordion reservations={[{ ...loanRes, status: 'completed' }]} isExpanded user={adminUser} isAdmin onReturnLoan={onReturnLoan} now={afterStart} />);
        expect(screen.queryByText('반납 처리')).toBeNull();
    });
});
