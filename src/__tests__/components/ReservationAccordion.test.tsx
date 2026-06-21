import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReservationAccordion from '../../components/common/ReservationAccordion';
import type { Reservation } from '../../types/reservation';

// 미래 예약(수정/취소 버튼 노출 조건) — 과거가 되지 않도록 먼 미래 날짜 사용
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
