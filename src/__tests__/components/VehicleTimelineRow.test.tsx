import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VehicleTimelineRow from '../../components/common/VehicleTimelineRow';
import { RANGE_START } from '../../lib/timelineUtils';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

const vehicle = { id: 'v1', name: '아반떼 11가1111' } as unknown as Vehicle;
const blockedVehicle = {
    id: 'v2', name: '쏘나타 22가2222',
    maintenance: { isBlocked: true },
} as unknown as Vehicle;

const res = {
    id: 'r1', vehicleId: 'v1', reservedByName: '홍길동', reservedByUid: 'u1',
    date: '2999-12-31', startTime: '09:00', endTime: '10:00', status: 'approved',
} as unknown as Reservation;

function baseProps() {
    return {
        vehicle,
        vRes: [res],
        dynamicStart: RANGE_START,
        hourLabels: [6, 9, 12, 15, 18, 21],
        gaps: [{ start: 600, end: 720 }],
        isDragging: false,
        dragOverlay: null,
        barRefCallback: vi.fn(),
        handleDragStart: vi.fn(),
        isPastDate: false,
        isExpanded: false,
        toggleExpand: vi.fn(),
        user: { uid: 'u1', id: 'u1' },
        isAdmin: false,
    };
}

describe('VehicleTimelineRow', () => {
    it('차량명을 표시한다', () => {
        render(<VehicleTimelineRow {...baseProps()} />);
        expect(screen.getByTitle('아반떼 11가1111')).toBeInTheDocument();
    });

    it('정비 중 차량은 🔧 표시', () => {
        render(<VehicleTimelineRow {...baseProps()} vehicle={blockedVehicle} vRes={[]} />);
        expect(screen.getByText(/🔧/)).toBeInTheDocument();
    });

    it('예약 블록을 렌더한다(title 속성)', () => {
        render(<VehicleTimelineRow {...baseProps()} />);
        // 예약 블록의 title은 "홍길동: 09:00~10:00 ..." 형태
        expect(screen.getByTitle(/홍길동: 09:00~10:00/)).toBeInTheDocument();
    });

    it('차량명 클릭 시 toggleExpand 호출', () => {
        const props = baseProps();
        render(<VehicleTimelineRow {...props} />);
        fireEvent.click(screen.getByTitle('아반떼 11가1111'));
        expect(props.toggleExpand).toHaveBeenCalledWith('v1');
    });

    it('빈 시간 영역 mouseDown 시 handleDragStart 호출', () => {
        const props = baseProps();
        render(<VehicleTimelineRow {...props} />);
        // gap title: "10:00~12:00 예약 가능 (드래그로 선택)"
        const gap = screen.getByTitle(/예약 가능 \(드래그로 선택\)/);
        fireEvent.mouseDown(gap);
        expect(props.handleDragStart).toHaveBeenCalledWith(expect.anything(), 'v1', 600, 720);
    });

    it('isExpanded=true면 예약 상세 아코디언을 표시한다', () => {
        render(<VehicleTimelineRow {...baseProps()} isExpanded />);
        // 아코디언의 시간 텍스트
        expect(screen.getByText(/09:00 ~ 10:00/)).toBeInTheDocument();
    });
});
