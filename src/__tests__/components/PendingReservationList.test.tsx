import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PendingReservationList from '../../components/admin/PendingReservationList';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useConfirmStore } from '../../store/useConfirmStore';
import { updateReservationStatus, rejectReservation, getPendingReservations } from '../../lib/firestore/reservations';

// Mocking Custom Hooks
vi.mock('../../hooks/useAuth');
vi.mock('../../hooks/useToast');
vi.mock('../../hooks/useRetry', () => ({
    default: () => ({
        runWithRetry: async (_: string, fn: () => Promise<unknown>) => await fn(),
    }),
}));

// Mocking Firestore functions
vi.mock('../../lib/firestore/reservations', () => ({
    updateReservationStatus: vi.fn(),
    rejectReservation: vi.fn(),
    getPendingReservations: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../lib/firestore/vehicles', () => ({
    getVehicles: vi.fn(() => Promise.resolve([
        { id: 'v1', name: '아반떼 11가1111' }
    ])),
}));

vi.mock('../../lib/firestore/users', () => ({
    getOrganizationMembers: vi.fn(() => Promise.resolve([
        { uid: 'u1', displayName: '홍길동', department: '개발팀' }
    ])),
}));

describe('PendingReservationList Component', () => {
    let mockToast: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock default behaviors
        vi.mocked(useAuth).mockReturnValue({
            userData: { organizationId: 'org1', uid: 'admin_u1' },
            loading: false,
        } as unknown as ReturnType<typeof useAuth>);

        mockToast = vi.fn();
        vi.mocked(useToast).mockReturnValue({ showToast: mockToast as unknown as ReturnType<typeof useToast>['showToast'] });

        // getPendingReservations Mocking
        vi.mocked(getPendingReservations).mockResolvedValue([
            {
                id: 'res1',
                organizationId: 'org1',
                vehicleId: 'v1',
                reservedByUid: 'u1',
                date: '2026-04-16',
                startTime: '09:00',
                endTime: '12:00',
                destination: '거래처 방문',
                status: 'pending',
                purpose: '테스트',
            } as import('../../types/reservation').Reservation
        ]);
        
        useConfirmStore.setState({
            confirm: vi.fn(() => Promise.resolve('test reason')),
        });
    });

    it('다크 모드와 호환되는 승인 대기 리스트 데이터가 성공적으로 렌더링된다', async () => {
        render(<React.Suspense fallback={<div>Loading</div>}><PendingReservationList /></React.Suspense>);
        
        // Data loading process completes
        await waitFor(() => {
            expect(screen.getByText(/승인 대기 중인 예약/)).toBeInTheDocument();
        });

        expect(screen.getByText('아반떼 11가1111')).toBeInTheDocument();
        expect(screen.getByText('개발팀 홍길동')).toBeInTheDocument();
        expect(screen.getByText('거래처 방문')).toBeInTheDocument();
        
        // 테마 및 스타일 검사 (dark 모드 클래스가 컴포넌트 최상단 컨테이너에 있는지 확인)
        const container = screen.getByText(/승인 대기 중인 예약/).closest('.bg-amber-50');
        expect(container).toHaveClass('dark:bg-amber-900/10');
    });

    it('승인 버튼 클릭 시 상태 업데이트 API가 호출되고 성공 토스트가 뜬다', async () => {
        render(<React.Suspense fallback={<div>Loading</div>}><PendingReservationList /></React.Suspense>);
        await waitFor(() => expect(screen.getByText('승인')).toBeInTheDocument());
        
        const approveBtn = screen.getByText('승인');
        fireEvent.click(approveBtn);

        await waitFor(() => {
            expect(updateReservationStatus).toHaveBeenCalledWith('res1', 'reserved', expect.any(Object), 'pending');
            expect(mockToast).toHaveBeenCalledWith('예약이 승인되었습니다.', 'success');
        });
    });

    it('반려 버튼 클릭 시 모달(confirmStore)이 팝업되고 상태 업데이트를 처리한다', async () => {
        render(<React.Suspense fallback={<div>Loading</div>}><PendingReservationList /></React.Suspense>);
        await waitFor(() => expect(screen.getByText('반려')).toBeInTheDocument());
        
        const confirmSpy = useConfirmStore.getState().confirm;
        const rejectBtn = screen.getByText('반려');
        fireEvent.click(rejectBtn);

        await waitFor(() => {
            // Check if useConfirmStore.confirm was triggered
            expect(confirmSpy).toHaveBeenCalled();
            // 반려는 도메인 함수(rejectReservation)로 캡슐화됨 — 사유가 그대로 전달되는지 확인
            expect(rejectReservation).toHaveBeenCalledWith('res1', 'test reason');
        });
    });
});
